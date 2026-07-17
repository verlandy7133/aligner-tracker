import Dexie, { type Table } from 'dexie';
import type { Order, Patient, Visit } from './types/Patient';

export type Setting = { key: string; value: unknown };

class AlignerDB extends Dexie {
  patients!: Table<Patient, string>;
  orders!: Table<Order, string>;
  settings!: Table<Setting, string>;
  visits!: Table<Visit, string>;

  constructor() {
    super('aligner-tracker');
    // v1 schema
    // 索引：id (pk) / chartNo / name / status / productLine / nextVisit / orderDate / *flags (multi-entry)
    this.version(1).stores({
      patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, *flags',
    });

    // v2: 副數進度拆成上下顎兩組欄位
    this.version(2)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, *flags',
      })
      .upgrade(async (tx) => {
        await tx
          .table('patients')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            // 舊資料的 totalAligners / currentAligner 不知道是上或下，預設搬到上顎
            p.totalAlignersUpper = (p.totalAligners as number | null | undefined) ?? null;
            p.currentAlignerUpper = (p.currentAligner as number | null | undefined) ?? null;
            p.totalAlignersLower = null;
            p.currentAlignerLower = null;
            delete p.totalAligners;
            delete p.currentAligner;
          });
      });

    // v3: 加 orders table（下單登記，跟技工所對帳用）
    this.version(3).stores({
      patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, *flags',
      orders: 'id, patientId, patientChartNo, orderDate, lab, receivedDate',
    });

    // v4: orders schema 重新設計，對齊 Excel 結構
    // 移除舊 orderDate / receivedDate 索引（欄位也改名）；新增 date / progress / doctor / lab 索引
    this.version(4)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
        orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
      })
      .upgrade(async (tx) => {
        // 舊 orders 全部清掉，重 seed 用新 schema (避免欄位名不一致)
        await tx.table('orders').clear();
      });

    // v5: 加 settings table (key-value，存 alert 閾值等使用者設定)
    this.version(5).stores({
      patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
      orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
      settings: 'key',
    });

    // v6: patient 加 markdownNote + photos (8-slot)
    // schema 形狀不變（沒加 index），只在 upgrade 補預設值給舊資料
    this.version(6)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
        orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('patients')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (p.markdownNote == null) p.markdownNote = '';
            if (p.photos == null) p.photos = {};
          });
      });

    // v7: photos value 從 string（單純檔名）升級成 PhotoMeta object（支援 rotate/flip）
    // 同時新加 portrait 4 個 slot 不需 schema 改動，只需 type 層新增
    this.version(7)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
        orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('patients')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const photos = (p.photos as Record<string, unknown>) || {};
            const migrated: Record<string, { filename: string }> = {};
            for (const [slot, val] of Object.entries(photos)) {
              if (typeof val === 'string') {
                // 舊格式：直接 filename string → 包成 PhotoMeta
                migrated[slot] = { filename: val };
              } else if (val && typeof val === 'object' && 'filename' in val) {
                // 已是 PhotoMeta（不應該發生、但保險）
                migrated[slot] = val as { filename: string };
              }
            }
            p.photos = migrated;
          });
      });

    // v8: portrait slot 重組
    // 移除: portraitProfileLeft, portraitProfileRight
    // 新加: portraitOblique45, portraitProfileRest, portraitProfileSmile
    // migrate: portraitProfileRight → portraitProfileRest（休息姿勢右側 = 標準 90° profile rest）
    //          portraitProfileLeft → 丟掉（左側照非標準矯正 view）
    this.version(8)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
        orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('patients')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const photos = (p.photos as Record<string, { filename: string }>) || {};
            // portraitProfileRight → portraitProfileRest（如果新 key 還沒被指定）
            if (photos.portraitProfileRight && !photos.portraitProfileRest) {
              photos.portraitProfileRest = photos.portraitProfileRight;
            }
            delete photos.portraitProfileRight;
            delete photos.portraitProfileLeft;
            p.photos = photos;
          });
      });

    // v9: 45° 拆休息/微笑兩個 slot
    // migrate: portraitOblique45 → portraitOblique45Rest（單一 slot 默認當 rest）
    this.version(9)
      .stores({
        patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
        orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('patients')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const photos = (p.photos as Record<string, { filename: string }>) || {};
            if (photos.portraitOblique45 && !photos.portraitOblique45Rest) {
              photos.portraitOblique45Rest = photos.portraitOblique45;
            }
            delete photos.portraitOblique45;
            p.photos = photos;
          });
      });

    // v10: 加 visits table（回診登記 v0.7.0）
    // 新 store、無資料遷移（append-only 記錄、舊 patient 資料不動）
    // index：id (pk) / patientId / date / updatedAt
    this.version(10).stores({
      patients: 'id, chartNo, name, status, productLine, nextVisit, orderDate, doctor, *flags',
      orders: 'id, patientId, patientChartNo, date, doctor, progress, lab',
      settings: 'key',
      visits: 'id, patientId, date, updatedAt',
    });
  }
}

export const db = new AlignerDB();

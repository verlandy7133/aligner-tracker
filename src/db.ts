import Dexie, { type Table } from 'dexie';
import type { Order, Patient } from './types/Patient';

export type Setting = { key: string; value: unknown };

class AlignerDB extends Dexie {
  patients!: Table<Patient, string>;
  orders!: Table<Order, string>;
  settings!: Table<Setting, string>;

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
  }
}

export const db = new AlignerDB();

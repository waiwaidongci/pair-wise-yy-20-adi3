import { ActualsState, PersistedActuals, TrainNetwork } from '../types/timetable';
import { hasActualReport } from '../utils/timetable-utils';

export const ACTUALS_STORAGE_KEY = 'pair-wise-yy-20.timetable-actuals';

/** 把实绩相关状态压缩为可落盘的投影（已确认实绩从运行线上剥离） */
export function buildPersistedActuals(network: TrainNetwork, actuals: ActualsState): PersistedActuals {
  const confirmed: PersistedActuals['confirmed'] = [];
  network.trains.forEach((train) => {
    train.stops.forEach((stop) => {
      if (!hasActualReport(stop)) return;
      confirmed.push({
        trainId: train.id,
        stationId: stop.stationId,
        actualArrival: stop.actualArrival,
        actualDeparture: stop.actualDeparture,
        batchId: stop.actualBatchId ?? 'LEGACY',
        sequence: stop.actualSequence ?? 0,
        operator: stop.actualOperator ?? '—',
        reportedAt: stop.actualReportedAt ?? 0,
      });
    });
  });
  return {
    version: 1,
    confirmed,
    appliedBatchIds: [...actuals.appliedBatchIds],
    nextSequence: actuals.nextSequence,
    // 发送中的批次落盘时记为失败，重新打开后以待补交姿态出现
    pending: actuals.pending.map((item) => ({ ...item, status: 'failed' as const })),
    discrepancies: [...actuals.discrepancies],
  };
}

/** 读取并校验本地保存的实绩切片；数据损坏时返回 null */
export function readPersistedActuals(): PersistedActuals | null {
  try {
    const raw = localStorage.getItem(ACTUALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedActuals>;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.confirmed) ||
      !Array.isArray(parsed.appliedBatchIds) ||
      !Array.isArray(parsed.pending) ||
      !Array.isArray(parsed.discrepancies) ||
      typeof parsed.nextSequence !== 'number'
    ) {
      return null;
    }
    return parsed as PersistedActuals;
  } catch {
    localStorage.removeItem(ACTUALS_STORAGE_KEY);
    return null;
  }
}

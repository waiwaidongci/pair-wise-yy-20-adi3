import { createReducer, on } from '@ngrx/store';
import {
  ActualDifference,
  ActualReportRecord,
  PendingActualReport,
  TimetableState,
  TrainNetwork,
  ViewportState,
} from '../types/timetable';
import {
  actualReportAccepted,
  actualReportPending,
  addNotice,
  batchShift,
  clearAllActualDifferences,
  clearBatchSelection,
  dismissActualDifference,
  dismissNotice,
  importNetwork,
  moveTrain,
  pendingReportResolved,
  pendingReportStillFailing,
  resetViewport,
  restorePersistedState,
  selectTrain,
  setPrintSection,
  toggleBatchTrain,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import { createMockNetwork, shiftTrain, updateStop } from '../utils/timetable-utils';

const INITIAL_VIEWPORT: ViewportState = {
  scaleX: 1.25,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

export const initialState: TimetableState = {
  network: createMockNetwork(),
  filter: {
    query: '',
    categories: [],
    direction: 'all',
  },
  viewport: INITIAL_VIEWPORT,
  selectedTrainId: 'T1',
  batchSelection: [],
  printSectionId: null,
  notices: [],
  pendingReports: [],
  actualDifferences: [],
};

interface ApplyActualResult {
  network: TrainNetwork;
  applied: boolean;
  reason?: 'duplicate' | 'stale';
  winnerBatch?: number;
}

/**
 * 实绩入库规则：
 * - 同一车次同一车站，批次严格递增才生效；
 * - 同一批次重复上报只算一次（duplicate）；
 * - 晚到的旧批次不能倒退已确认的实绩（stale），差异保留供核对。
 */
function applyActualRecord(state: TimetableState, record: ActualReportRecord): ApplyActualResult {
  const train = state.network.trains.find((item) => item.id === record.trainId);
  const stop = train?.stops.find((item) => item.stationId === record.stationId);
  if (!train || !stop) return { network: state.network, applied: false };
  if (stop.actualBatch != null && record.batch <= stop.actualBatch) {
    return {
      network: state.network,
      applied: false,
      reason: record.batch === stop.actualBatch ? 'duplicate' : 'stale',
      winnerBatch: stop.actualBatch,
    };
  }
  const stops = train.stops.map((item) =>
    item.stationId === record.stationId
      ? {
          ...item,
          actualArrival: record.actualArrival,
          actualDeparture: record.actualDeparture,
          actualBatch: record.batch,
          actualReporter: record.reporter,
          actualReportedAt: record.reportedAt,
        }
      : item,
  );
  return {
    network: {
      ...state.network,
      trains: state.network.trains.map((item) => (item.id === train.id ? { ...item, stops } : item)),
    },
    applied: true,
  };
}

function buildDifference(
  state: TimetableState,
  record: ActualReportRecord,
  reason: 'duplicate' | 'stale',
  winnerBatch: number,
): ActualDifference {
  return {
    id: `diff:${record.trainId}:${record.stationId}:${record.batch}:${state.actualDifferences.length}`,
    trainId: record.trainId,
    stationId: record.stationId,
    winnerBatch,
    loserBatch: record.batch,
    loserActualArrival: record.actualArrival,
    loserActualDeparture: record.actualDeparture,
    loserReporter: record.reporter,
    reason,
    recordedAt: record.reportedAt,
  };
}

export const timetableReducer = createReducer(
  initialState,
  on(selectTrain, (state, { trainId }) => ({
    ...state,
    selectedTrainId: trainId,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) => ({ ...train, selected: train.id === trainId })),
    },
  })),
  on(toggleBatchTrain, (state, { trainId }) => ({
    ...state,
    batchSelection: state.batchSelection.includes(trainId)
      ? state.batchSelection.filter((id) => id !== trainId)
      : [...state.batchSelection, trainId],
  })),
  on(clearBatchSelection, (state) => ({ ...state, batchSelection: [] })),
  on(updateFilter, (state, { filter }) => ({
    ...state,
    filter: { ...state.filter, ...filter },
  })),
  on(updateViewport, (state, { viewport }) => ({
    ...state,
    viewport: { ...state.viewport, ...viewport },
  })),
  on(resetViewport, (state) => ({ ...state, viewport: INITIAL_VIEWPORT })),
  on(moveTrain, (state, { trainId, deltaMinutes }) => ({
    ...state,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? shiftTrain(train, deltaMinutes) : train,
      ),
    },
  })),
  on(batchShift, (state, { deltaMinutes }) => {
    const ids = state.batchSelection.length > 0
      ? new Set(state.batchSelection)
      : new Set(state.selectedTrainId ? [state.selectedTrainId] : []);
    return {
      ...state,
      network: {
        ...state.network,
        trains: state.network.trains.map((train) =>
          ids.has(train.id) ? shiftTrain(train, deltaMinutes) : train,
        ),
      },
    };
  }),
  on(updateTrainStop, (state, { trainId, stationId, changes }) => ({
    ...state,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? updateStop(train, stationId, changes) : train,
      ),
    },
  })),
  on(setPrintSection, (state, { sectionId }) => ({ ...state, printSectionId: sectionId })),
  on(importNetwork, (state, { network }) => ({
    ...state,
    network,
    selectedTrainId: network.trains[0]?.id ?? null,
    batchSelection: [],
    viewport: INITIAL_VIEWPORT,
    notices: [...state.notices, `已导入 ${network.trains.length} 趟列车、${network.stations.length} 个车站`],
  })),
  on(addNotice, (state, { message }) => ({ ...state, notices: [...state.notices, message] })),
  on(dismissNotice, (state, { index }) => ({
    ...state,
    notices: state.notices.filter((_, noticeIndex) => noticeIndex !== index),
  })),
  on(restorePersistedState, (state, { state: persisted }) => ({
    ...state,
    filter: persisted.filter ? { ...state.filter, ...persisted.filter } : state.filter,
    viewport: persisted.viewport ? { ...state.viewport, ...persisted.viewport } : state.viewport,
  })),
  on(actualReportAccepted, (state, { record }) => {
    const result = applyActualRecord(state, record);
    // 无论入库还是保留差异，同站被取代的待补交记录都清除，避免恢复后重复入库。
    const pendingReports = state.pendingReports.filter(
      (pending) =>
        !(
          pending.trainId === record.trainId &&
          pending.stationId === record.stationId &&
          pending.batch <= record.batch
        ),
    );
    if (!result.applied && result.reason) {
      // 先到生效，后到保留差异：实绩不回退，差异留待核对。
      return {
        ...state,
        pendingReports,
        actualDifferences: [
          ...state.actualDifferences,
          buildDifference(state, record, result.reason, result.winnerBatch ?? record.batch),
        ],
      };
    }
    return { ...state, network: result.network, pendingReports };
  }),
  on(actualReportPending, (state, { report }) => {
    // 同一车次同一车站同一批次的待补交记录只留一条。
    const duplicated = state.pendingReports.some(
      (pending) =>
        pending.trainId === report.trainId &&
        pending.stationId === report.stationId &&
        pending.batch === report.batch,
    );
    return duplicated
      ? state
      : { ...state, pendingReports: [...state.pendingReports, report] };
  }),
  on(pendingReportResolved, (state, { id, record }) => {
    const result = applyActualRecord(state, record);
    const pendingReports = state.pendingReports.filter((pending) => pending.id !== id);
    if (!result.applied && result.reason) {
      return {
        ...state,
        pendingReports,
        actualDifferences: [
          ...state.actualDifferences,
          buildDifference(state, record, result.reason, result.winnerBatch ?? record.batch),
        ],
      };
    }
    return { ...state, network: result.network, pendingReports };
  }),
  on(pendingReportStillFailing, (state, { id, error }) => ({
    ...state,
    pendingReports: state.pendingReports.map((pending) =>
      pending.id === id
        ? { ...pending, attempts: pending.attempts + 1, lastError: error }
        : pending,
    ),
  })),
  on(dismissActualDifference, (state, { id }) => ({
    ...state,
    actualDifferences: state.actualDifferences.filter((difference) => difference.id !== id),
  })),
  on(clearAllActualDifferences, (state) => ({ ...state, actualDifferences: [] })),
);

import { createReducer, on } from '@ngrx/store';
import {
  ActualsState,
  TimetableState,
  ViewportState,
} from '../types/timetable';
import {
  actualReportFailed,
  addNotice,
  batchShift,
  clearBatchSelection,
  confirmActualReport,
  discardPendingReport,
  dismissNotice,
  importNetwork,
  moveTrain,
  resetViewport,
  restorePersistedActuals,
  restorePersistedState,
  retryActualReport,
  selectTrain,
  setActualsChannelOffline,
  setPrintSection,
  submitActualReport,
  toggleBatchTrain,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import { applyActualBatch, createMockNetwork, shiftTrain, updateStop } from '../utils/timetable-utils';

const INITIAL_VIEWPORT: ViewportState = {
  scaleX: 1.25,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

const INITIAL_ACTUALS: ActualsState = {
  appliedBatchIds: [],
  nextSequence: 1,
  pending: [],
  discrepancies: [],
  channelOffline: false,
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
  actuals: INITIAL_ACTUALS,
};

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
    actuals: { ...INITIAL_ACTUALS, channelOffline: state.actuals.channelOffline },
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
  on(submitActualReport, (state, { batch }) => {
    const pending = [
      ...state.actuals.pending.filter((item) => item.batch.batchId !== batch.batchId),
      { batch, attempts: 0, status: 'sending' as const },
    ];
    return {
      ...state,
      actuals: {
        ...state.actuals,
        pending,
        nextSequence: Math.max(state.actuals.nextSequence, batch.sequence + 1),
      },
    };
  }),
  on(confirmActualReport, (state, { batch }) => {
    const pending = state.actuals.pending.filter((item) => item.batch.batchId !== batch.batchId);
    if (state.actuals.appliedBatchIds.includes(batch.batchId)) {
      // 同一批次重复上报（含补交重试）只算一次，不重复入库
      return {
        ...state,
        actuals: { ...state.actuals, pending },
        notices: [...state.notices, `批次 ${batch.batchId} 重复上报，已按幂等忽略`],
      };
    }
    const outcome = applyActualBatch(state.network, batch);
    const parts = [`确认 ${outcome.confirmed} 站`];
    if (outcome.corrected > 0) parts.push(`更正 ${outcome.corrected} 站`);
    if (outcome.discrepancies.length > 0) parts.push(`保留差异 ${outcome.discrepancies.length} 条`);
    if (outcome.stale > 0) parts.push(`拒绝旧批次 ${outcome.stale} 站`);
    if (outcome.invalid > 0) parts.push(`无效 ${outcome.invalid} 条`);
    return {
      ...state,
      network: { ...state.network, trains: outcome.trains },
      actuals: {
        ...state.actuals,
        appliedBatchIds: [...state.actuals.appliedBatchIds, batch.batchId],
        pending,
        discrepancies: [...state.actuals.discrepancies, ...outcome.discrepancies].slice(-100),
      },
      notices: [...state.notices, `批次 ${batch.batchId}（${batch.operator}）已入库：${parts.join('，')}`],
    };
  }),
  on(actualReportFailed, (state, { batchId, reason }) => ({
    ...state,
    actuals: {
      ...state.actuals,
      pending: state.actuals.pending.map((item) =>
        item.batch.batchId === batchId
          ? { ...item, attempts: item.attempts + 1, status: 'failed' as const, lastError: reason }
          : item,
      ),
    },
    notices: [...state.notices, `批次 ${batchId} 上报失败（${reason}），已留待补交`],
  })),
  on(retryActualReport, (state, { batchId }) => ({
    ...state,
    actuals: {
      ...state.actuals,
      pending: state.actuals.pending.map((item) =>
        item.batch.batchId === batchId ? { ...item, status: 'sending' as const } : item,
      ),
    },
  })),
  on(discardPendingReport, (state, { batchId }) => ({
    ...state,
    actuals: {
      ...state.actuals,
      pending: state.actuals.pending.filter((item) => item.batch.batchId !== batchId),
    },
  })),
  on(setActualsChannelOffline, (state, { offline }) => ({
    ...state,
    actuals: { ...state.actuals, channelOffline: offline },
  })),
  on(restorePersistedActuals, (state, { persisted }) => {
    const confirmedByStop = new Map(
      persisted.confirmed.map((entry) => [`${entry.trainId}:${entry.stationId}`, entry] as const),
    );
    const trains = state.network.trains.map((train) => {
      let changed = false;
      const stops = train.stops.map((stop) => {
        const entry = confirmedByStop.get(`${train.id}:${stop.stationId}`);
        if (!entry) return stop;
        changed = true;
        return {
          ...stop,
          actualArrival: entry.actualArrival,
          actualDeparture: entry.actualDeparture,
          actualBatchId: entry.batchId,
          actualSequence: entry.sequence,
          actualOperator: entry.operator,
          actualReportedAt: entry.reportedAt,
        };
      });
      return changed ? { ...train, stops } : train;
    });
    return {
      ...state,
      network: { ...state.network, trains },
      actuals: {
        ...state.actuals,
        appliedBatchIds: [...persisted.appliedBatchIds],
        nextSequence: Math.max(state.actuals.nextSequence, persisted.nextSequence),
        pending: persisted.pending.map((item) => ({ ...item, status: 'failed' as const })),
        discrepancies: [...persisted.discrepancies],
      },
    };
  }),
);

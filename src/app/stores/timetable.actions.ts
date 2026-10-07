import { createAction, props } from '@ngrx/store';
import {
  ActualReportRecord,
  PendingActualReport,
  TimetableFilter,
  TrainNetwork,
  TrainStop,
  ViewportState,
} from '../types/timetable';

export const selectTrain = createAction('[Timetable] Select train', props<{ trainId: string | null }>());
export const toggleBatchTrain = createAction('[Timetable] Toggle batch train', props<{ trainId: string }>());
export const clearBatchSelection = createAction('[Timetable] Clear batch selection');
export const updateFilter = createAction('[Timetable] Update filter', props<{ filter: Partial<TimetableFilter> }>());
export const updateViewport = createAction('[Timetable] Update viewport', props<{ viewport: Partial<ViewportState> }>());
export const resetViewport = createAction('[Timetable] Reset viewport');
export const moveTrain = createAction('[Timetable] Move train', props<{ trainId: string; deltaMinutes: number }>());
export const batchShift = createAction('[Timetable] Batch shift', props<{ deltaMinutes: number }>());
export const updateTrainStop = createAction(
  '[Timetable] Update train stop',
  props<{ trainId: string; stationId: string; changes: Partial<TrainStop> }>(),
);
export const setPrintSection = createAction('[Timetable] Set print section', props<{ sectionId: string | null }>());
export const importNetwork = createAction('[Timetable] Import network', props<{ network: TrainNetwork }>());
export const addNotice = createAction('[Timetable] Add notice', props<{ message: string }>());
export const dismissNotice = createAction('[Timetable] Dismiss notice', props<{ index: number }>());
export const restorePersistedState = createAction(
  '[Timetable] Restore persisted state',
  props<{ state: Partial<Pick<TimetableStatePayload, 'filter' | 'viewport'>> }>(),
);

// ---- 实绩上报 ----
/** 值班员提交实绩：先经上报通道，成功入库、失败转入待补交。 */
export const submitActualReport = createAction(
  '[实绩] 提交上报',
  props<{ record: ActualReportRecord }>(),
);
/** 上报成功，实绩入库。 */
export const actualReportAccepted = createAction(
  '[实绩] 上报入库',
  props<{ record: ActualReportRecord }>(),
);
/** 上报失败，转入待补交。 */
export const actualReportPending = createAction(
  '[实绩] 待补交',
  props<{ report: import('../types/timetable').PendingActualReport }>(),
);
/** 批量补交所有待补交记录。 */
export const retryPendingReports = createAction('[实绩] 批量补交');
/** 补交单条待补交记录。 */
export const retryOnePendingReport = createAction('[实绩] 逐条补交', props<{ id: string }>());
/** 补交成功，实绩入库（不重复入库）。 */
export const pendingReportResolved = createAction(
  '[实绩] 补交入库',
  props<{ id: string; record: ActualReportRecord }>(),
);
/** 补交仍失败，保留待补交状态。 */
export const pendingReportStillFailing = createAction(
  '[实绩] 补交仍失败',
  props<{ id: string; error: string }>(),
);
export const dismissActualDifference = createAction('[实绩] 关闭差异', props<{ id: string }>());
export const clearAllActualDifferences = createAction('[实绩] 清空差异');

interface TimetableStatePayload {
  filter: TimetableFilter;
  viewport: ViewportState;
}

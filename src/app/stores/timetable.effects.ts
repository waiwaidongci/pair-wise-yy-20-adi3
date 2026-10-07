import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY, delay, filter, fromEvent, map, merge, mergeMap, of, switchMap, tap, withLatestFrom, Observable } from 'rxjs';
import {
  actualReportAccepted,
  actualReportPending,
  addNotice,
  batchShift,
  importNetwork,
  moveTrain,
  pendingReportResolved,
  pendingReportStillFailing,
  resetViewport,
  retryOnePendingReport,
  retryPendingReports,
  submitActualReport,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import {
  selectFilter,
  selectNetwork,
  selectPendingCount,
  selectPendingReports,
  selectViewport,
} from './timetable.selectors';
import { ActualReportRecord, PendingActualReport } from '../types/timetable';

const STORAGE_KEY = 'pair-wise-yy-20.timetable-view';

@Injectable()
export class TimetableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);

  readonly persistView = createEffect(
    () =>
      this.actions$.pipe(
        ofType(updateViewport, updateFilter, resetViewport),
        withLatestFrom(this.store.select(selectViewport), this.store.select(selectFilter)),
        tap(([, viewport, filter]) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewport, filter }));
        }),
      ),
    { dispatch: false },
  );

  readonly announceChanges = createEffect(
    () =>
      this.actions$.pipe(
        ofType(moveTrain, batchShift, updateTrainStop, importNetwork),
        tap((action) => {
          if ('deltaMinutes' in action) {
            console.info('[运行图] 时刻已调整', action);
          }
        }),
      ),
    { dispatch: false },
  );

  /**
   * 模拟车站上报通道：约 18% 概率失败，用于演示「上报失败 → 待补交 → 恢复重试」。
   * 真实环境中替换为 HTTP 上报即可，失败时进入待补交队列。
   */
  private simulateReport(): Observable<boolean> {
    const ok = Math.random() >= 0.18;
    return of(ok).pipe(delay(250 + Math.random() * 450));
  }

  private toRecord(pending: PendingActualReport): ActualReportRecord {
    return {
      trainId: pending.trainId,
      stationId: pending.stationId,
      actualArrival: pending.actualArrival,
      actualDeparture: pending.actualDeparture,
      batch: pending.batch,
      reporter: pending.reporter,
      reportedAt: new Date().toISOString(),
    };
  }

  /** 值班员提交实绩：先经上报通道，成功入库、失败留住待补交。 */
  readonly submitActual$ = createEffect(() =>
    this.actions$.pipe(
      ofType(submitActualReport),
      withLatestFrom(this.store.select(selectPendingReports)),
      // 同一车次同一车站同一批次的待补交记录不重复提交。
      filter(
        ([{ record }, pending]) =>
          !pending.some(
            (item) =>
              item.trainId === record.trainId &&
              item.stationId === record.stationId &&
              item.batch === record.batch,
          ),
      ),
      switchMap(([{ record }]) =>
        this.simulateReport().pipe(
          map((ok) =>
            ok
              ? actualReportAccepted({ record })
              : actualReportPending({
                  report: {
                    ...record,
                    id: `pending:${record.trainId}:${record.stationId}:${record.batch}`,
                    attempts: 1,
                    lastError: '上报未确认，已转入待补交，恢复后自动重试',
                    createdAt: new Date().toISOString(),
                  },
                }),
          ),
        ),
      ),
    ),
  );

  /** 补交单条待补交记录。 */
  readonly retryOne$ = createEffect(() =>
    this.actions$.pipe(
      ofType(retryOnePendingReport),
      withLatestFrom(this.store.select(selectPendingReports)),
      mergeMap(([action, pending]) => {
        const report = pending.find((item) => item.id === action.id);
        if (!report) return EMPTY;
        return this.simulateReport().pipe(
          map((ok) =>
            ok
              ? pendingReportResolved({ id: report.id, record: this.toRecord(report) })
              : pendingReportStillFailing({ id: report.id, error: '网络仍未恢复，稍后重试' }),
          ),
        );
      }),
    ),
  );

  /** 批量补交：逐条重试，任何一条成功都不重复入库（入库时按批次校验）。 */
  readonly retryAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(retryPendingReports),
      withLatestFrom(this.store.select(selectPendingReports)),
      mergeMap(([, pending]) =>
        pending.length === 0
          ? EMPTY
          : merge(
              ...pending.map((report) =>
                this.simulateReport().pipe(
                  map((ok) =>
                    ok
                      ? pendingReportResolved({ id: report.id, record: this.toRecord(report) })
                      : pendingReportStillFailing({
                          id: report.id,
                          error: '网络仍未恢复，稍后重试',
                        }),
                  ),
                ),
              ),
            ),
      ),
    ),
  );

  /** 网络恢复后自动补交。 */
  readonly onlineRetry$ = createEffect(() =>
    fromEvent(window, 'online').pipe(
      withLatestFrom(this.store.select(selectPendingCount)),
      filter(([, count]) => count > 0),
      map(() => retryPendingReports()),
    ),
  );

  /** 实绩相关提示：入库、待补交、差异保留。 */
  readonly actualNotices$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(actualReportAccepted, pendingReportResolved, actualReportPending, pendingReportStillFailing),
        withLatestFrom(this.store.select(selectNetwork), this.store.select(selectPendingReports)),
        tap(([action, network, pendingReports]) => {
          const record = 'record' in action ? action.record : undefined;
          const report = 'report' in action ? action.report : undefined;
          const id = 'id' in action ? action.id : undefined;
          const pending = report ?? pendingReports.find((item) => item.id === id);
          const target = record ?? pending;
          if (!target) return;
          const train = network.trains.find((item) => item.id === target.trainId);
          const station = network.stations.find((item) => item.id === target.stationId);
          const trainName = train?.number ?? target.trainId;
          const stationName = station?.name ?? target.stationId;
          if (action.type === actualReportPending.type || action.type === pendingReportStillFailing.type) {
            const attempts = isPendingReport(target) ? target.attempts : 1;
            this.store.dispatch(
              addNotice({
                message:
                  attempts > 1
                    ? `补交仍失败：${trainName} ${stationName}（第 ${attempts} 次），已留住待补交。`
                    : `上报失败已转入待补交：${trainName} ${stationName}，网络恢复后自动重试。`,
              }),
            );
            return;
          }
          // 入库类：若该站已有更新批次，则本次为差异保留，不回退实绩。
          const stop = train?.stops.find((item) => item.stationId === target.stationId);
          const superseded = stop?.actualBatch != null && target.batch <= stop.actualBatch;
          if (superseded) {
            this.store.dispatch(
              addNotice({
                message: `旧批次未生效：${trainName} ${stationName} 第 ${target.batch} 批次已保留差异，实绩维持第 ${stop?.actualBatch} 批次。`,
              }),
            );
          } else {
            this.store.dispatch(
              addNotice({
                message: `实绩已入库：${trainName} ${stationName}（第 ${target.batch} 批次，值班员 ${target.reporter}），冲突结论已按实绩重算。`,
              }),
            );
          }
        }),
      ),
    { dispatch: false },
  );
}

function isPendingReport(
  target: ActualReportRecord | PendingActualReport,
): target is PendingActualReport {
  return 'attempts' in target;
}

import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, EMPTY, mergeMap, of, tap, withLatestFrom } from 'rxjs';
import {
  actualReportFailed,
  batchShift,
  confirmActualReport,
  discardPendingReport,
  importNetwork,
  moveTrain,
  resetViewport,
  retryActualReport,
  retryAllPendingReports,
  setActualsChannelOffline,
  submitActualReport,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import { selectActuals, selectFilter, selectNetwork, selectViewport } from './timetable.selectors';
import { ACTUALS_STORAGE_KEY, buildPersistedActuals } from './actuals-persistence';
import { ActualsChannelService } from '../services/actuals-channel.service';
import { ActualReportBatch } from '../types/timetable';

const STORAGE_KEY = 'pair-wise-yy-20.timetable-view';

@Injectable()
export class TimetableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly channel = inject(ActualsChannelService);

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

  /** 同步通讯开关到模拟通道 */
  readonly syncChannelMode = createEffect(
    () =>
      this.actions$.pipe(
        ofType(setActualsChannelOffline),
        tap(({ offline }) => {
          this.channel.offline = offline;
        }),
      ),
    { dispatch: false },
  );

  /** 提交/重试批次：经通道发送，成功入库、失败留驻待补交 */
  readonly sendActualReport = createEffect(() =>
    this.actions$.pipe(
      ofType(submitActualReport, retryActualReport),
      withLatestFrom(this.store.select(selectActuals)),
      mergeMap(([action, actuals]) => {
        const batch =
          'batch' in action
            ? action.batch
            : actuals.pending.find((item) => item.batch.batchId === action.batchId)?.batch;
        if (!batch) return EMPTY;
        return this.channel.send(batch).pipe(
          mergeMap((sent) => of(confirmActualReport({ batch: sent }))),
          catchError((error: unknown) =>
            of(
              actualReportFailed({
                batchId: batch.batchId,
                reason: error instanceof Error ? error.message : '上报通道异常',
              }),
            ),
          ),
        );
      }),
    ),
  );

  /** 通讯恢复后一键补交全部待补交批次；入库按 batchId 幂等，重试不重复 */
  readonly resendPendingReports = createEffect(() =>
    this.actions$.pipe(
      ofType(retryAllPendingReports),
      withLatestFrom(this.store.select(selectActuals)),
      mergeMap(([, actuals]) =>
        actuals.pending.filter((item) => item.status === 'failed').map((item) => item.batch),
      ),
      mergeMap((batch: ActualReportBatch) =>
        this.channel.send(batch).pipe(
          mergeMap((sent) => of(confirmActualReport({ batch: sent }))),
          catchError((error: unknown) =>
            of(
              actualReportFailed({
                batchId: batch.batchId,
                reason: error instanceof Error ? error.message : '上报通道异常',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** 实绩切片落盘：已确认实绩 + 批次簿记 + 待补交队列 */
  readonly persistActuals = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          submitActualReport,
          confirmActualReport,
          actualReportFailed,
          retryActualReport,
          discardPendingReport,
          importNetwork,
        ),
        withLatestFrom(this.store.select(selectNetwork), this.store.select(selectActuals)),
        tap(([, network, actuals]) => {
          localStorage.setItem(ACTUALS_STORAGE_KEY, JSON.stringify(buildPersistedActuals(network, actuals)));
        }),
      ),
    { dispatch: false },
  );
}

import { Injectable } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ActualReportBatch } from '../types/timetable';

/**
 * 实绩上报通道。前端以本地模拟代替车站—调度台链路：
 * 正常时延迟送达；通讯中断开关打开时一律失败，
 * 供“失败留驻待补交、恢复后重试”流程使用。
 */
@Injectable({ providedIn: 'root' })
export class ActualsChannelService {
  /** 模拟通讯中断 */
  offline = false;

  send(batch: ActualReportBatch): Observable<ActualReportBatch> {
    return timer(260).pipe(
      mergeMap(() => {
        if (this.offline) {
          return throwError(() => new Error('通讯中断，批次未送达'));
        }
        return [batch];
      }),
    );
  }
}

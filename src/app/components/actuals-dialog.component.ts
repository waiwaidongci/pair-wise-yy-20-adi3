import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, firstValueFrom, map, take } from 'rxjs';
import {
  discardPendingReport,
  retryActualReport,
  retryAllPendingReports,
  setActualsChannelOffline,
  submitActualReport,
} from '../stores/timetable.actions';
import { selectActuals, selectNetwork } from '../stores/timetable.selectors';
import { ActualReportBatch, ActualReportEntry, Train, TrainStop } from '../types/timetable';
import { formatTime, minutesFromClock } from '../utils/time';
import { hasActualReport } from '../utils/timetable-utils';

interface StopFormRow {
  stationId: string;
  arrival: string;
  departure: string;
}

@Component({
  selector: 'app-actuals-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="实绩上报与批次管理"
      [visible]="visible"
      (visibleChange)="onDialogVisibleChange($event)"
      [modal]="true"
      [style]="{ width: '780px' }"
      [draggable]="false"
    >
      <ng-container *ngIf="viewModel$ | async as vm">
        <div class="actuals-dialog">
          <div class="dialog-row dialog-row--controls">
            <label>
              <span>值班员</span>
              <p-select
                [options]="operators"
                [(ngModel)]="operator"
                size="small"
                styleClass="operator-select"
                ariaLabel="上报值班员"
              ></p-select>
            </label>
            <label>
              <span>车次</span>
              <p-select
                [options]="vm.trainOptions"
                [(ngModel)]="trainId"
                (ngModelChange)="onTrainChange()"
                optionLabel="label"
                optionValue="value"
                [filter]="true"
                filterBy="label"
                size="small"
                styleClass="train-select"
                ariaLabel="上报车次"
              ></p-select>
            </label>
            <label>
              <span>批次序号</span>
              <p-inputNumber
                [(ngModel)]="batchSequence"
                [min]="1"
                [showButtons]="true"
                [step]="1"
                size="small"
                ariaLabel="上报批次序号"
              ></p-inputNumber>
            </label>
            <span class="spacer"></span>
            <p-button
              [label]="vm.actuals.channelOffline ? '通讯：中断（模拟）' : '通讯：正常'"
              [icon]="vm.actuals.channelOffline ? 'pi pi-ban' : 'pi pi-wifi'"
              [severity]="vm.actuals.channelOffline ? 'danger' : 'secondary'"
              size="small"
              (onClick)="toggleOffline(vm.actuals.channelOffline)"
            ></p-button>
          </div>
          <p class="batch-hint">
            批次序号默认自增，新批次可更正旧实绩；两位值班员按同一序号同时提交时先到生效、后到保留差异；晚到的旧批次（序号更小）不会倒退已确认结论。
          </p>

          <div class="stop-table-wrap" *ngIf="trainId && vm.trainMap.get(trainId) as train">
            <table class="stop-table">
              <thead>
                <tr>
                  <th>车站</th>
                  <th>计划到—发</th>
                  <th>实际到达</th>
                  <th>实际发车</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let stop of train.stops">
                  <td class="station-cell">{{ vm.stationMap.get(stop.stationId) || stop.stationId }}</td>
                  <td class="plan-cell">{{ formatTime(stop.arrival) }}—{{ formatTime(stop.departure) }}</td>
                  <td>
                    <input
                      pInputText
                      size="small"
                      [(ngModel)]="rowFor(stop.stationId).arrival"
                      [placeholder]="formatTime(stop.arrival)"
                      [attr.aria-label]="train.number + ' ' + (vm.stationMap.get(stop.stationId) || '') + ' 实际到达'"
                    />
                  </td>
                  <td>
                    <input
                      pInputText
                      size="small"
                      [(ngModel)]="rowFor(stop.stationId).departure"
                      [placeholder]="formatTime(stop.departure)"
                      [attr.aria-label]="train.number + ' ' + (vm.stationMap.get(stop.stationId) || '') + ' 实际发车'"
                    />
                  </td>
                  <td class="status-cell">
                    <ng-container *ngIf="hasActual(stop); else notReported">
                      <p-tag
                        [value]="'已确认 · 序号' + (stop.actualSequence ?? '—')"
                        severity="success"
                        [pTooltip]="(stop.actualOperator ?? '') + ' · 批次 ' + (stop.actualBatchId ?? '—')"
                        tooltipPosition="top"
                      ></p-tag>
                      <p-tag
                        *ngIf="vm.discrepancyKeys.has(train.id + ':' + stop.stationId)"
                        value="有差异"
                        severity="warn"
                      ></p-tag>
                    </ng-container>
                    <ng-template #notReported>
                      <span class="missing-tag">未上报</span>
                    </ng-template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="form-error" *ngIf="formError" role="alert">{{ formError }}</div>

          <div class="dialog-row">
            <p-button
              label="填入计划时刻"
              icon="pi pi-copy"
              severity="secondary"
              size="small"
              (onClick)="fillPlanned()"
            ></p-button>
            <p-button
              label="清空"
              icon="pi pi-eraser"
              severity="secondary"
              [text]="true"
              size="small"
              (onClick)="clearRows()"
            ></p-button>
            <span class="spacer"></span>
            <p-button label="提交批次" icon="pi pi-send" size="small" (onClick)="submit()"></p-button>
          </div>

          <section class="pending-block" *ngIf="vm.actuals.pending.length">
            <header>
              <strong>待补交批次（{{ vm.actuals.pending.length }}）</strong>
              <span>上报失败的批次留驻于此，通讯恢复后重试不会重复入库</span>
              <span class="spacer"></span>
              <p-button
                label="全部补交"
                icon="pi pi-replay"
                severity="secondary"
                size="small"
                (onClick)="retryAll()"
              ></p-button>
            </header>
            <ul>
              <li *ngFor="let item of vm.actuals.pending">
                <span class="batch-id">{{ item.batch.batchId }}</span>
                <span class="batch-meta">
                  序号 {{ item.batch.sequence }} · {{ item.batch.operator }} · {{ item.batch.entries.length }} 站
                </span>
                <p-tag
                  [value]="item.status === 'sending' ? '发送中' : '待补交 · 失败 ' + item.attempts + ' 次'"
                  [severity]="item.status === 'sending' ? 'info' : 'danger'"
                ></p-tag>
                <span class="spacer"></span>
                <button
                  type="button"
                  class="link-button"
                  [disabled]="item.status === 'sending'"
                  (click)="retry(item.batch.batchId)"
                >
                  重试
                </button>
                <button type="button" class="link-button link-button--plain" (click)="discard(item.batch.batchId)">
                  放弃
                </button>
              </li>
            </ul>
          </section>

          <section class="discrepancy-block" *ngIf="vm.actuals.discrepancies.length">
            <header>
              <strong>差异记录（{{ vm.actuals.discrepancies.length }}）</strong>
              <span>同一车次同一车站的同时提交：先到生效，后到值保留备查</span>
            </header>
            <ul>
              <li *ngFor="let d of vm.actuals.discrepancies">
                <strong>{{ vm.trainMap.get(d.trainId)?.number || d.trainId }} · {{ vm.stationMap.get(d.stationId) || d.stationId }}</strong>
                <span>
                  生效 {{ fmt(d.kept.actualArrival) }}/{{ fmt(d.kept.actualDeparture) }}（{{ d.kept.operator }}）
                </span>
                <span class="kept-diff">
                  保留 {{ fmt(d.incoming.actualArrival) }}/{{ fmt(d.incoming.actualDeparture) }}（{{ d.incoming.operator }}）
                </span>
              </li>
            </ul>
          </section>
        </div>
      </ng-container>
    </p-dialog>
  `,
  styles: [
    `
      .actuals-dialog {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .dialog-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .dialog-row--controls label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: #66758a;
        font-size: 11px;
      }

      .operator-select {
        min-width: 118px;
      }

      .train-select {
        min-width: 170px;
      }

      .spacer {
        flex: 1;
      }

      .batch-hint {
        margin: 0;
        padding: 8px 10px;
        border-radius: 5px;
        background: #f2f7fc;
        color: #5d7186;
        font-size: 11px;
        line-height: 1.6;
      }

      .stop-table-wrap {
        max-height: 300px;
        overflow: auto;
        border: 1px solid #e1e7ee;
        border-radius: 6px;
      }

      .stop-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .stop-table th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 7px 10px;
        background: #f6f9fc;
        color: #5b6b7f;
        font-size: 11px;
        text-align: left;
      }

      .stop-table td {
        padding: 5px 10px;
        border-top: 1px solid #eef2f6;
        color: #33465c;
      }

      .stop-table input {
        width: 86px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .plan-cell {
        color: #8493a6;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .station-cell {
        font-weight: 700;
        white-space: nowrap;
      }

      .status-cell {
        white-space: nowrap;
      }

      .status-cell p-tag + p-tag {
        margin-left: 5px;
      }

      .missing-tag {
        padding: 2px 7px;
        border-radius: 4px;
        background: #f1f4f8;
        color: #8a97a8;
        font-size: 10px;
      }

      .form-error {
        padding: 7px 10px;
        border: 1px solid #f2c1bd;
        border-radius: 5px;
        background: #fff6f5;
        color: #b42318;
        font-size: 11px;
      }

      .pending-block,
      .discrepancy-block {
        border: 1px solid #ead9b0;
        border-radius: 6px;
        background: #fffdf6;
        padding: 9px 11px;
      }

      .discrepancy-block {
        border-color: #e4d3ec;
        background: #fdf9ff;
      }

      .pending-block header,
      .discrepancy-block header {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #4d5f75;
        font-size: 12px;
      }

      .pending-block header span,
      .discrepancy-block header span {
        color: #8a97a8;
        font-size: 10px;
      }

      .pending-block ul,
      .discrepancy-block ul {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
      }

      .pending-block li,
      .discrepancy-block li {
        display: flex;
        align-items: center;
        gap: 9px;
        color: #55677c;
        font-size: 11px;
      }

      .batch-id {
        font-weight: 700;
        color: #2c435c;
      }

      .batch-meta {
        color: #7b8a9c;
      }

      .link-button {
        border: 0;
        background: transparent;
        color: #1f6fa9;
        font-size: 11px;
        text-decoration: underline;
        cursor: pointer;
      }

      .link-button:disabled {
        color: #9aa7b6;
        cursor: default;
        text-decoration: none;
      }

      .link-button--plain {
        color: #8a97a8;
      }

      .kept-diff {
        color: #7c3aed;
      }
    `,
  ],
})
export class ActualsDialogComponent implements OnChanges {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();

  private readonly store = inject(Store);

  readonly operators = ['值班员甲', '值班员乙'];
  operator = this.operators[0];
  trainId: string | null = null;
  batchSequence = 1;
  formError = '';
  private rows: Record<string, StopFormRow> = {};

  readonly viewModel$ = combineLatest({
    network: this.store.select(selectNetwork),
    actuals: this.store.select(selectActuals),
  }).pipe(
    map(({ network, actuals }) => ({
      trainOptions: [...network.trains]
        .sort((a, b) => a.number.localeCompare(b.number, 'zh-Hans-CN'))
        .map((train) => ({
          label: `${train.number}（${train.direction === 'up' ? '上行' : '下行'}）`,
          value: train.id,
        })),
      trainMap: new Map(network.trains.map((train) => [train.id, train])),
      stationMap: new Map(network.stations.map((station) => [station.id, station.name])),
      discrepancyKeys: new Set(actuals.discrepancies.map((item) => `${item.trainId}:${item.stationId}`)),
      actuals,
    })),
  );

  ngOnChanges(): void {
    if (this.visible) {
      void this.initialize();
    }
  }

  onDialogVisibleChange(value: boolean): void {
    this.visibleChange.emit(value);
  }

  rowFor(stationId: string): StopFormRow {
    let row = this.rows[stationId];
    if (!row) {
      row = { stationId, arrival: '', departure: '' };
      this.rows[stationId] = row;
    }
    return row;
  }

  hasActual(stop: TrainStop): boolean {
    return hasActualReport(stop);
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  fmt(value: number | undefined): string {
    return value == null ? '—' : formatTime(value);
  }

  async onTrainChange(): Promise<void> {
    const vm = await firstValueFrom(this.viewModel$.pipe(take(1)));
    this.rebuildRows(vm.trainMap.get(this.trainId ?? ''));
  }

  async fillPlanned(): Promise<void> {
    const vm = await firstValueFrom(this.viewModel$.pipe(take(1)));
    const train = vm.trainMap.get(this.trainId ?? '');
    if (!train) return;
    train.stops.forEach((stop) => {
      const row = this.rowFor(stop.stationId);
      row.arrival = formatTime(stop.arrival);
      row.departure = formatTime(stop.departure);
    });
  }

  clearRows(): void {
    Object.values(this.rows).forEach((row) => {
      row.arrival = '';
      row.departure = '';
    });
  }

  async submit(): Promise<void> {
    const vm = await firstValueFrom(this.viewModel$.pipe(take(1)));
    const train = this.trainId ? vm.trainMap.get(this.trainId) : undefined;
    if (!train) {
      this.formError = '请选择要上报的车次';
      return;
    }
    if (!this.batchSequence || this.batchSequence < 1) {
      this.formError = '批次序号需为不小于 1 的整数';
      return;
    }
    const entries: ActualReportEntry[] = [];
    const invalidStations: string[] = [];
    train.stops.forEach((stop) => {
      const row = this.rows[stop.stationId];
      if (!row) return;
      const arrivalText = row.arrival.trim();
      const departureText = row.departure.trim();
      if (!arrivalText && !departureText) return;
      const arrival = arrivalText ? parseClock(arrivalText) : undefined;
      const departure = departureText ? parseClock(departureText) : undefined;
      if ((arrivalText && arrival == null) || (departureText && departure == null)) {
        invalidStations.push(vm.stationMap.get(stop.stationId) ?? stop.stationId);
        return;
      }
      entries.push({
        trainId: train.id,
        stationId: stop.stationId,
        actualArrival: arrival,
        actualDeparture: departure,
      });
    });
    if (invalidStations.length > 0) {
      this.formError = `时刻格式应为 HH:MM，请检查：${invalidStations.join('、')}`;
      return;
    }
    if (entries.length === 0) {
      this.formError = '请至少填写一站的实际到达或实际发车';
      return;
    }
    const batch: ActualReportBatch = {
      batchId: newBatchId(),
      sequence: Math.round(this.batchSequence),
      operator: this.operator,
      submittedAt: Date.now(),
      entries,
    };
    this.store.dispatch(submitActualReport({ batch }));
    // 连续提交默认自增序号；需要模拟同时提交时可手动改回相同序号
    this.batchSequence = Math.round(this.batchSequence) + 1;
    this.formError = '';
  }

  retry(batchId: string): void {
    this.store.dispatch(retryActualReport({ batchId }));
  }

  retryAll(): void {
    this.store.dispatch(retryAllPendingReports());
  }

  discard(batchId: string): void {
    this.store.dispatch(discardPendingReport({ batchId }));
  }

  toggleOffline(currentlyOffline: boolean): void {
    this.store.dispatch(setActualsChannelOffline({ offline: !currentlyOffline }));
    if (currentlyOffline) {
      // 通讯恢复：自动补交全部待补交批次（入库幂等，不会重复）
      this.store.dispatch(retryAllPendingReports());
    }
  }

  private async initialize(): Promise<void> {
    const vm = await firstValueFrom(this.viewModel$.pipe(take(1)));
    if (!this.trainId || !vm.trainMap.has(this.trainId)) {
      this.trainId = vm.trainOptions[0]?.value ?? null;
    }
    this.batchSequence = vm.actuals.nextSequence;
    this.rebuildRows(vm.trainMap.get(this.trainId ?? ''));
    this.formError = '';
  }

  private rebuildRows(train: Train | undefined): void {
    this.rows = {};
    train?.stops.forEach((stop) => {
      this.rows[stop.stationId] = {
        stationId: stop.stationId,
        arrival: stop.actualArrival != null ? formatTime(stop.actualArrival) : '',
        departure: stop.actualDeparture != null ? formatTime(stop.actualDeparture) : '',
      };
    });
  }
}

function parseClock(text: string): number | undefined {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(text)) return undefined;
  return minutesFromClock(text);
}

function newBatchId(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 46656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `B-${time}-${random}`;
}

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ActualDifference, PendingActualReport, TrainStop } from '../types/timetable';
import { formatTime, minutesFromClock } from '../utils/time';

const REPORTER_STORAGE_KEY = 'pair-wise-yy-20.reporter';

@Component({
  selector: 'app-actual-report-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actual-form" [class.actual-form--pending]="!!pending">
      <div class="actual-form__status">
        <ng-container *ngIf="reported; else unreported">
          <p-tag
            [value]="'实绩 ' + formatTime(stop.actualArrival!) + ' → ' + formatTime(stop.actualDeparture!)"
            severity="success"
          ></p-tag>
          <p-tag [value]="'批次 ' + stop.actualBatch" severity="info"></p-tag>
          <small>{{ stop.actualReporter }} · {{ formatReportedAt(stop.actualReportedAt) }}</small>
        </ng-container>
        <ng-template #unreported>
          <p-tag value="未上报" severity="warn"></p-tag>
          <small>按计划值兼容显示</small>
        </ng-template>
        <p-tag
          *ngIf="pending"
          [value]="'待补交 · 第 ' + pending.attempts + ' 次'"
          severity="danger"
        ></p-tag>
      </div>

      <div class="actual-form__inputs">
        <label class="actual-form__field">
          <span>实际到达</span>
          <input type="time" [(ngModel)]="arrivalClock" [disabled]="!!pending" />
        </label>
        <label class="actual-form__field">
          <span>实际发车</span>
          <input type="time" [(ngModel)]="departureClock" [disabled]="!!pending" />
        </label>
        <label class="actual-form__field actual-form__field--reporter">
          <span>值班员</span>
          <input type="text" [(ngModel)]="reporter" [disabled]="!!pending" placeholder="值班员" />
        </label>
        <p-button
          *ngIf="!pending"
          label="上报实绩"
          size="small"
          icon="pi pi-send"
          [disabled]="!canSubmit"
          (onClick)="submitForm()"
        ></p-button>
        <p-button
          *ngIf="pending"
          label="重新补交"
          size="small"
          severity="danger"
          icon="pi pi-replay"
          (onClick)="retry.emit(pending.id)"
        ></p-button>
      </div>

      <div class="actual-form__error" *ngIf="formError">
        <i class="pi pi-exclamation-triangle"></i>
        <span>{{ formError }}</span>
      </div>
      <div class="actual-form__error actual-form__error--pending" *ngIf="pending?.lastError">
        <i class="pi pi-cloud-upload"></i>
        <span>{{ pending?.lastError }}</span>
      </div>

      <div class="actual-form__diff" *ngFor="let diff of differences">
        <i class="pi pi-info-circle"></i>
        <span>
          差异保留：{{ diff.loserReporter }} 上报
          {{ formatTime(diff.loserActualArrival) }} → {{ formatTime(diff.loserActualDeparture) }}
          （{{ diff.reason === 'duplicate' ? '同一批次重复上报' : '晚到的旧批次' }}，第 {{ diff.loserBatch }} 批）未生效，
          实绩维持第 {{ diff.winnerBatch }} 批。
        </span>
      </div>
    </div>
  `,
  styles: [
    `
      .actual-form {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 8px;
        border-top: 1px dashed #e2e8f0;
        background: #f7fafc;
      }

      .actual-form--pending {
        background: #fff7f6;
      }

      .actual-form__status {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      .actual-form__status small {
        color: #8494a6;
        font-size: 10px;
      }

      .actual-form__inputs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-end;
      }

      .actual-form__field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        color: #738094;
        font-size: 10px;
      }

      .actual-form__field input {
        width: 96px;
        padding: 4px 6px;
        border: 1px solid #cfd8e3;
        border-radius: 4px;
        background: #fff;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .actual-form__field--reporter input {
        width: 88px;
      }

      .actual-form__error {
        display: flex;
        gap: 5px;
        align-items: center;
        color: #b42318;
        font-size: 10px;
      }

      .actual-form__error--pending {
        color: #9a5b00;
      }

      .actual-form__diff {
        display: flex;
        gap: 5px;
        align-items: flex-start;
        color: #6b7280;
        font-size: 10px;
        line-height: 1.5;
      }

      .actual-form__diff i {
        margin-top: 1px;
        color: #b45309;
      }
    `,
  ],
})
export class ActualReportFormComponent implements OnChanges {
  @Input({ required: true }) stop!: TrainStop;
  @Input() pending: PendingActualReport | null = null;
  @Input() differences: ActualDifference[] = [];

  @Output() actualSubmit = new EventEmitter<{
    actualArrival: number;
    actualDeparture: number;
    reporter: string;
  }>();
  @Output() retry = new EventEmitter<string>();

  arrivalClock = '00:00';
  departureClock = '00:00';
  reporter = '值班员';
  formError = '';

  get reported(): boolean {
    return this.stop.actualArrival != null || this.stop.actualDeparture != null;
  }

  get canSubmit(): boolean {
    return this.formError === '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stop']) {
      this.arrivalClock = formatTime(this.stop.actualArrival ?? this.stop.arrival);
      this.departureClock = formatTime(this.stop.actualDeparture ?? this.stop.departure);
    }
    const saved = localStorage.getItem(REPORTER_STORAGE_KEY);
    if (saved) this.reporter = saved;
    this.validate();
  }

  validate(): void {
    const arrival = minutesFromClock(this.arrivalClock);
    const departure = minutesFromClock(this.departureClock);
    if (departure < arrival) {
      this.formError = '实际发车不能早于实际到达';
      return;
    }
    this.formError = '';
  }

  submitForm(): void {
    this.validate();
    if (this.formError) return;
    const reporter = this.reporter.trim() || '值班员';
    localStorage.setItem(REPORTER_STORAGE_KEY, reporter);
    this.actualSubmit.emit({
      actualArrival: minutesFromClock(this.arrivalClock),
      actualDeparture: minutesFromClock(this.departureClock),
      reporter,
    });
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  formatReportedAt(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(
      date.getHours(),
    ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

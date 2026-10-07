import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, map } from 'rxjs';
import { ConflictPanelComponent } from '../components/conflict-panel.component';
import { GraphCanvasComponent } from '../components/graph-canvas.component';
import { TrainInspectorComponent } from '../components/train-inspector.component';
import {
  addNotice,
  batchShift,
  clearAllActualDifferences,
  clearBatchSelection,
  dismissActualDifference,
  importNetwork,
  moveTrain,
  resetViewport,
  restorePersistedState,
  retryOnePendingReport,
  retryPendingReports,
  selectTrain,
  setPrintSection,
  submitActualReport,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from '../stores/timetable.actions';
import {
  selectActualDifferenceCount,
  selectActualDifferences,
  selectBatchSelection,
  selectConflictSummary,
  selectConflicts,
  selectFilter,
  selectNetwork,
  selectNextBatch,
  selectNotices,
  selectPendingCount,
  selectPendingReports,
  selectPrintSectionId,
  selectSelectedTrainId,
  selectSelectedConflicts,
  selectSelectedTrain,
  selectViewport,
  selectVisibleTrains,
} from '../stores/timetable.selectors';
import { ConflictType, TimetableConflict } from '../types/timetable';
import { formatTime } from '../utils/time';
import { normalizeImportedNetwork } from '../utils/timetable-utils';

@Component({
  selector: 'app-timetable-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    MessageModule,
    MultiSelectModule,
    SelectModule,
    TagModule,
    TooltipModule,
    GraphCanvasComponent,
    TrainInspectorComponent,
    ConflictPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *ngIf="viewModel$ | async as vm">
      <section class="editor-page" [class.editor-page--printing]="!!vm.printSectionId">
        <div class="toolbar">
          <div class="toolbar__title">
            <span>运行图编辑</span>
            <strong>{{ vm.network.lineName }}</strong>
            <small>{{ vm.visibleTrains.length }} / {{ vm.network.trains.length }} 趟列车</small>
          </div>
          <div class="toolbar__filters">
            <span class="search-box">
              <i class="pi pi-search"></i>
              <input
                pInputText
                [(ngModel)]="query"
                (ngModelChange)="setQuery($event)"
                placeholder="车次"
                aria-label="按车次筛选"
              />
            </span>
            <p-multiSelect
              [options]="categories"
              [(ngModel)]="selectedCategories"
              (ngModelChange)="setCategories($event)"
              optionLabel="label"
              optionValue="value"
              placeholder="车型"
              [maxSelectedLabels]="1"
              size="small"
              ariaLabel="按车型筛选"
            ></p-multiSelect>
            <p-select
              [options]="directions"
              [(ngModel)]="direction"
              (ngModelChange)="setDirection($event)"
              optionLabel="label"
              optionValue="value"
              size="small"
              ariaLabel="按方向筛选"
            ></p-select>
          </div>
          <div class="toolbar__actions">
            <p-button
              icon="pi pi-search-minus"
              severity="secondary"
              [text]="true"
              pTooltip="缩小"
              (onClick)="zoom(0.85)"
            ></p-button>
            <p-button
              icon="pi pi-search-plus"
              severity="secondary"
              [text]="true"
              pTooltip="放大"
              (onClick)="zoom(1.15)"
            ></p-button>
            <p-button
              icon="pi pi-expand"
              severity="secondary"
              [text]="true"
              pTooltip="复位视图"
              (onClick)="resetView()"
            ></p-button>
            <span class="toolbar__divider"></span>
            <p-button
              icon="pi pi-upload"
              label="导入 JSON"
              severity="secondary"
              size="small"
              (onClick)="importDialog = true"
            ></p-button>
            <p-button
              icon="pi pi-download"
              label="导出数据"
              severity="secondary"
              size="small"
              (onClick)="exportNetwork(vm.network)"
            ></p-button>
          </div>
        </div>

        <div class="summary-bar">
          <div class="summary-item">
            <i class="pi pi-exclamation-triangle"></i>
            <span>严重冲突</span>
            <strong class="danger">{{ vm.summary.danger }}</strong>
          </div>
          <div class="summary-item">
            <i class="pi pi-clock"></i>
            <span>追踪预警</span>
            <strong>{{ vm.summary.headway }}</strong>
          </div>
          <div class="summary-item">
            <i class="pi pi-building"></i>
            <span>股道占用</span>
            <strong>{{ vm.summary.track }}</strong>
          </div>
          <div class="summary-item">
            <i class="pi pi-arrow-right-arrow-left"></i>
            <span>越行风险</span>
            <strong>{{ vm.summary.overtake }}</strong>
          </div>
          <div class="summary-item" *ngIf="vm.pendingCount > 0">
            <i class="pi pi-cloud-upload"></i>
            <span>待补交</span>
            <strong class="warning">{{ vm.pendingCount }}</strong>
            <p-button
              label="一键补交"
              size="small"
              severity="secondary"
              (onClick)="retryAll()"
            ></p-button>
          </div>
          <div class="summary-item" *ngIf="vm.differenceCount > 0">
            <i class="pi pi-exclamation-circle"></i>
            <span>差异待核对</span>
            <strong>{{ vm.differenceCount }}</strong>
            <p-button
              label="查看"
              size="small"
              severity="secondary"
              (onClick)="differencesDialog = true"
            ></p-button>
          </div>
          <div class="summary-bar__spacer"></div>
          <div class="batch-control">
            <span>批量平移</span>
            <p-inputNumber
              [(ngModel)]="batchMinutes"
              [showButtons]="true"
              [min]="-60"
              [max]="60"
              [step]="1"
              suffix=" 分"
              size="small"
              ariaLabel="批量平移分钟"
            ></p-inputNumber>
            <p-button
              icon="pi pi-arrows-h"
              label="应用到选中"
              size="small"
              severity="secondary"
              [disabled]="vm.batchSelection.length === 0"
              (onClick)="applyBatchShift()"
            ></p-button>
            <span class="selection-count" *ngIf="vm.batchSelection.length">
              已选 {{ vm.batchSelection.length }}
              <button type="button" (click)="clearBatch()">清除</button>
            </span>
          </div>
          <div class="print-control">
            <p-select
              [options]="vm.network.sections"
              [(ngModel)]="printSectionId"
              optionLabel="id"
              optionValue="id"
              placeholder="选择区间"
              size="small"
              ariaLabel="选择打印区间"
            ></p-select>
            <p-button
              icon="pi pi-print"
              label="打印区间"
              size="small"
              [disabled]="!printSectionId"
              (onClick)="printSection()"
            ></p-button>
          </div>
        </div>

        <div class="workspace">
          <aside class="workspace__left panel">
            <app-train-inspector
              [train]="vm.selectedTrain"
              [stations]="vm.network.stations"
              [pendingReports]="vm.pendingReports"
              [differences]="vm.differences"
              (trainShifted)="shiftSelected($event, vm.selectedTrain?.id || null)"
              (stopUpdated)="updateStop($event, vm.selectedTrain?.id || null)"
              (actualSubmitted)="submitActual($event)"
              (pendingRetried)="retryPending($event)"
            ></app-train-inspector>
          </aside>

          <section class="graph-panel">
            <div class="graph-panel__header">
              <div>
                <strong>时间—里程坐标图</strong>
                <span>红色区间表示正在违反安全间隔</span>
              </div>
              <div class="legend">
                <span><i class="legend-line"></i>计划运行线</span>
                <span><i class="legend-actual"></i>实绩点</span>
                <span><i class="legend-stop"></i>停站</span>
                <span><i class="legend-danger"></i>冲突</span>
              </div>
            </div>
            <app-graph-canvas
              [network]="vm.network"
              [trains]="vm.visibleTrains"
              [conflicts]="vm.conflicts"
              [viewport]="vm.viewport"
              [selectedTrainId]="vm.selectedTrainId"
              [batchSelection]="vm.batchSelection"
              [printSectionId]="vm.printSectionId"
              [useActualBasis]="!!vm.printSectionId"
              (trainSelected)="selectTrainAction($event)"
              (trainMoved)="moveTrainAction($event)"
              (viewportChanged)="updateViewportAction($event)"
              (batchToggled)="toggleBatch($event)"
            ></app-graph-canvas>
            <footer class="graph-panel__footer">
              <span>视图缩放 {{ (vm.viewport.scaleX * 100).toFixed(0) }}%</span>
              <span>Alt + 点击可加入批量选择</span>
              <span *ngIf="vm.batchSelection.length">批量选中 {{ vm.batchSelection.length }} 趟</span>
            </footer>
          </section>

          <aside class="workspace__right panel">
            <app-conflict-panel
              [conflicts]="vm.selectedConflicts"
              (conflictSelected)="focusConflict($event)"
            ></app-conflict-panel>
          </aside>
        </div>

        <div class="notice-stack" *ngIf="vm.notices.length">
          <p-message
            *ngFor="let notice of vm.notices; let index = index"
            severity="success"
            [text]="notice"
            [closable]="true"
            (onClose)="dismissNoticeAction(index)"
          ></p-message>
        </div>
      </section>

      <p-dialog
        header="导入线路与运行图数据"
        [(visible)]="importDialog"
        [modal]="true"
        [style]="{ width: '520px' }"
        [draggable]="false"
      >
        <div class="import-dialog">
          <p>
            选择包含 <code>lineName</code>、<code>stations</code>、<code>sections</code> 和
            <code>trains</code> 的 JSON 文件。导入前会检查车站引用和必填结构。
          </p>
          <label class="file-drop">
            <input type="file" accept="application/json,.json" (change)="onImportFile($event)" />
            <i class="pi pi-cloud-upload"></i>
            <strong>选择 JSON 文件</strong>
            <span>或点击此处浏览本机文件</span>
          </label>
          <div class="import-template">
            <span>当前内置线路：</span>
            <strong>{{ (viewModel$ | async)?.network?.lineName }}</strong>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="取消" severity="secondary" (onClick)="importDialog = false"></p-button>
        </ng-template>
      </p-dialog>

      <p-dialog
        header="实绩上报差异核对"
        [(visible)]="differencesDialog"
        [modal]="true"
        [style]="{ width: '640px' }"
        [draggable]="false"
      >
        <div class="differences-dialog">
          <p>
            两位值班员对同一车次同一车站提交实绩时，先到的批次生效，后到的差异保留在此核对；晚到的旧批次不会回退已确认的实绩。
          </p>
          <table class="differences-table">
            <thead>
              <tr>
                <th>车次</th>
                <th>车站</th>
                <th>未生效上报</th>
                <th>原因</th>
                <th>维持批次</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let diff of (viewModel$ | async)?.differences">
                <td><strong>{{ trainNumber(diff.trainId) }}</strong></td>
                <td>{{ stationName(diff.stationId) }}</td>
                <td>
                  <div class="diff-times">
                    {{ formatTime(diff.loserActualArrival) }} → {{ formatTime(diff.loserActualDeparture) }}
                  </div>
                  <small>{{ diff.loserReporter }} · 第 {{ diff.loserBatch }} 批</small>
                </td>
                <td>
                  <span class="diff-reason">
                    {{ diff.reason === 'duplicate' ? '同批次重复' : '旧批次迟到' }}
                  </span>
                </td>
                <td><span class="diff-winner">第 {{ diff.winnerBatch }} 批</span></td>
                <td>
                  <p-button
                    icon="pi pi-times"
                    size="small"
                    [text]="true"
                    (onClick)="dismissDifference(diff.id)"
                  ></p-button>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="differences-dialog__footer" *ngIf="(viewModel$ | async)?.differences?.length">
            <p-button label="全部清空" size="small" severity="secondary" (onClick)="clearAllDifferences()"></p-button>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="关闭" severity="secondary" (onClick)="differencesDialog = false"></p-button>
        </ng-template>
      </p-dialog>
    </ng-container>
  `,
})
export class TimetableEditorPageComponent implements OnInit {
  readonly store = inject(Store);
  readonly categories = [
    { label: '高铁', value: '高铁' },
    { label: '动车', value: '动车' },
    { label: '普速', value: '普速' },
    { label: '货运', value: '货运' },
  ];
  readonly directions = [
    { label: '全部方向', value: 'all' },
    { label: '上行', value: 'up' },
    { label: '下行', value: 'down' },
  ];

  query = '';
  selectedCategories: string[] = [];
  direction: 'up' | 'down' | 'all' = 'all';
  batchMinutes = 5;
  printSectionId: string | null = null;
  importDialog = false;
  differencesDialog = false;

  readonly viewModel$ = combineLatest({
    network: this.store.select(selectNetwork),
    visibleTrains: this.store.select(selectVisibleTrains),
    selectedTrain: this.store.select(selectSelectedTrain),
    selectedTrainId: this.store.select(selectSelectedTrainId),
    batchSelection: this.store.select(selectBatchSelection),
    filter: this.store.select(selectFilter),
    viewport: this.store.select(selectViewport),
    conflicts: this.store.select(selectConflicts),
    selectedConflicts: this.store.select(selectSelectedConflicts),
    summary: this.store.select(selectConflictSummary),
    printSectionId: this.store.select(selectPrintSectionId),
    notices: this.store.select(selectNotices),
    pendingReports: this.store.select(selectPendingReports),
    pendingCount: this.store.select(selectPendingCount),
    differences: this.store.select(selectActualDifferences),
    differenceCount: this.store.select(selectActualDifferenceCount),
  }).pipe(map((state) => state));

  ngOnInit(): void {
    try {
      const persisted = localStorage.getItem('pair-wise-yy-20.timetable-view');
      if (persisted) {
        this.store.dispatch(restorePersistedState({ state: JSON.parse(persisted) }));
      }
    } catch {
      localStorage.removeItem('pair-wise-yy-20.timetable-view');
    }
  }

  @HostListener('window:afterprint')
  onAfterPrint(): void {
    setTimeout(() => this.store.dispatch(setPrintSection({ sectionId: null })), 50);
  }

  setQuery(value: string): void {
    this.store.dispatch(updateFilter({ filter: { query: value } }));
  }

  setCategories(value: string[]): void {
    this.store.dispatch(updateFilter({ filter: { categories: value as never[] } }));
  }

  setDirection(value: 'up' | 'down' | 'all'): void {
    this.store.dispatch(updateFilter({ filter: { direction: value } }));
  }

  zoom(factor: number): void {
    this.store.select(selectViewport).subscribe((viewport) => {
      this.store.dispatch(
        updateViewport({
          viewport: {
            scaleX: Math.max(0.5, Math.min(5, viewport.scaleX * factor)),
            scaleY: Math.max(0.5, Math.min(4, viewport.scaleY * factor)),
          },
        }),
      );
    }).unsubscribe();
  }

  resetView(): void {
    this.store.dispatch(resetViewport());
  }

  clearBatch(): void {
    this.store.dispatch(clearBatchSelection());
  }

  selectTrainAction(trainId: string): void {
    this.store.dispatch(selectTrain({ trainId }));
  }

  moveTrainAction(event: { trainId: string; deltaMinutes: number }): void {
    this.store.dispatch(moveTrain(event));
  }

  updateViewportAction(viewport: Partial<{ scaleX: number; scaleY: number; offsetX: number; offsetY: number }>): void {
    this.store.dispatch(updateViewport({ viewport }));
  }

  dismissNoticeAction(index: number): void {
    this.store.dispatch({ type: '[Timetable] Dismiss notice', index });
  }

  shiftSelected(deltaMinutes: number, trainId: string | null): void {
    if (!trainId) return;
    this.store.dispatch(moveTrain({ trainId, deltaMinutes }));
  }

  updateStop(
    event: { stationId: string; changes: Record<string, unknown> },
    trainId: string | null,
  ): void {
    if (!trainId) return;
    this.store.dispatch(
      updateTrainStop({
        trainId,
        stationId: event.stationId,
        changes: event.changes as never,
      }),
    );
  }

  /** 值班员提交实绩：批次号取该站已上报批次 + 1，先到生效、旧批次不回退。 */
  submitActual(event: {
    trainId: string;
    stationId: string;
    actualArrival: number;
    actualDeparture: number;
    reporter: string;
  }): void {
    let batch = 1;
    this.store
      .select(selectNextBatch(event.trainId, event.stationId))
      .subscribe((value) => (batch = value))
      .unsubscribe();
    this.store.dispatch(
      submitActualReport({
        record: {
          trainId: event.trainId,
          stationId: event.stationId,
          actualArrival: event.actualArrival,
          actualDeparture: event.actualDeparture,
          batch,
          reporter: event.reporter,
          reportedAt: new Date().toISOString(),
        },
      }),
    );
  }

  retryPending(id: string): void {
    this.store.dispatch(retryOnePendingReport({ id }));
  }

  retryAll(): void {
    this.store.dispatch(retryPendingReports());
  }

  dismissDifference(id: string): void {
    this.store.dispatch(dismissActualDifference({ id }));
  }

  clearAllDifferences(): void {
    this.store.dispatch(clearAllActualDifferences());
    this.differencesDialog = false;
  }

  toggleBatch(trainId: string): void {
    this.store.dispatch({ type: '[Timetable] Toggle batch train', trainId });
  }

  applyBatchShift(): void {
    this.store.dispatch(batchShift({ deltaMinutes: this.batchMinutes }));
  }

  focusConflict(conflict: TimetableConflict): void {
    const trainId = conflict.trainIds[0];
    if (trainId) this.store.dispatch(selectTrain({ trainId }));
  }

  printSection(): void {
    if (!this.printSectionId) return;
    this.store.dispatch(setPrintSection({ sectionId: this.printSectionId }));
    setTimeout(() => window.print(), 300);
  }

  exportNetwork(network: unknown): void {
    const blob = new Blob([JSON.stringify(network, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `运行图数据-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      let fallbackNetwork: unknown;
      this.store.select(selectNetwork).subscribe((network) => {
        fallbackNetwork = network;
      }).unsubscribe();
      const network = normalizeImportedNetwork(raw, fallbackNetwork as never);
      this.store.dispatch(importNetwork({ network }));
      this.importDialog = false;
    } catch (error) {
      this.store.dispatch(addNotice({ message: error instanceof Error ? error.message : '无法解析 JSON 文件' }));
    } finally {
      input.value = '';
    }
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  trainNumber(trainId: string): string {
    let number = trainId;
    this.store
      .select(selectNetwork)
      .subscribe((network) => {
        number = network.trains.find((train) => train.id === trainId)?.number ?? trainId;
      })
      .unsubscribe();
    return number;
  }

  stationName(stationId: string): string {
    let name = stationId;
    this.store
      .select(selectNetwork)
      .subscribe((network) => {
        name = network.stations.find((station) => station.id === stationId)?.name ?? stationId;
      })
      .unsubscribe();
    return name;
  }
}

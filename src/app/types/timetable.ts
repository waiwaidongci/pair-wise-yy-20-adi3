export type TrainDirection = 'up' | 'down';
export type TrainCategory = '高铁' | '动车' | '普速' | '货运';
export type StopKind = 'stop' | 'pass' | 'meet' | 'overtake';

export interface StationTrack {
  id: string;
  name: string;
  main: boolean;
}

export interface Station {
  id: string;
  name: string;
  shortName: string;
  km: number;
  tracks: StationTrack[];
}

export interface RailSection {
  id: string;
  fromStationId: string;
  toStationId: string;
  distanceKm: number;
  minHeadwayMin: number;
  baseRunningMin: number;
}

export interface TrainStop {
  stationId: string;
  kind: StopKind;
  arrival: number;
  departure: number;
  trackId: string;
  meetTrainNumber?: string;
  /** 实绩：车站上报的实际到达（分钟）。旧数据缺省，按计划值兼容显示 */
  actualArrival?: number;
  /** 实绩：车站上报的实际发车（分钟） */
  actualDeparture?: number;
  /** 确认该实绩的上报批次号（幂等键） */
  actualBatchId?: string;
  /** 确认该实绩的批次序号，用于拒绝晚到的旧批次 */
  actualSequence?: number;
  /** 上报值班员 */
  actualOperator?: string;
  /** 上报时间戳（毫秒） */
  actualReportedAt?: number;
}

export interface Train {
  id: string;
  number: string;
  category: TrainCategory;
  direction: TrainDirection;
  color: string;
  stops: TrainStop[];
  selected: boolean;
}

export interface TrainNetwork {
  lineName: string;
  stations: Station[];
  sections: RailSection[];
  trains: Train[];
}

/** 实绩上报批次中的一条车站到发记录 */
export interface ActualReportEntry {
  trainId: string;
  stationId: string;
  actualArrival?: number;
  actualDeparture?: number;
}

/** 一批车站上报的实际到发。batchId 为幂等键，sequence 为批次序号（大者更新） */
export interface ActualReportBatch {
  batchId: string;
  sequence: number;
  operator: string;
  submittedAt: number;
  entries: ActualReportEntry[];
}

/** 上报失败留驻的待补交批次 */
export interface PendingActualBatch {
  batch: ActualReportBatch;
  attempts: number;
  status: 'sending' | 'failed';
  lastError?: string;
}

/** 两位值班员同时上报同一车次同一车站时，后到提交保留的差异 */
export interface ActualDiscrepancy {
  id: string;
  trainId: string;
  stationId: string;
  kept: {
    actualArrival?: number;
    actualDeparture?: number;
    operator: string;
    batchId: string;
    sequence: number;
  };
  incoming: {
    actualArrival?: number;
    actualDeparture?: number;
    operator: string;
    batchId: string;
    sequence: number;
  };
  recordedAt: number;
}

export interface ActualsState {
  /** 已入库批次号，重复上报/重试凭此只算一次 */
  appliedBatchIds: string[];
  /** 下一个建议批次序号 */
  nextSequence: number;
  /** 上报失败待补交的批次 */
  pending: PendingActualBatch[];
  /** 后到提交保留的差异记录 */
  discrepancies: ActualDiscrepancy[];
  /** 模拟通讯中断（演示上报失败与补交） */
  channelOffline: boolean;
}

/** 已确认实绩的持久化投影（从运行线上剥离，避免整网落盘） */
export interface PersistedActualStop {
  trainId: string;
  stationId: string;
  actualArrival?: number;
  actualDeparture?: number;
  batchId: string;
  sequence: number;
  operator: string;
  reportedAt: number;
}

export interface PersistedActuals {
  version: 1;
  confirmed: PersistedActualStop[];
  appliedBatchIds: string[];
  nextSequence: number;
  pending: PendingActualBatch[];
  discrepancies: ActualDiscrepancy[];
}

export type ConflictType = 'headway' | 'track' | 'overtake';
export type ConflictSeverity = 'danger' | 'warning';

export interface TimeRange {
  start: number;
  end: number;
}

export interface TimetableConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  trainIds: string[];
  sectionId?: string;
  stationId?: string;
  timeRange: TimeRange;
  suggestedShift: TimeRange;
}

export interface ViewportState {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface TimetableFilter {
  query: string;
  categories: TrainCategory[];
  direction: TrainDirection | 'all';
}

export interface TimetableState {
  network: TrainNetwork;
  filter: TimetableFilter;
  viewport: ViewportState;
  selectedTrainId: string | null;
  batchSelection: string[];
  printSectionId: string | null;
  notices: string[];
  actuals: ActualsState;
}

export interface ImportedNetworkFile {
  lineName?: string;
  stations?: Station[];
  sections?: RailSection[];
  trains?: Train[];
}

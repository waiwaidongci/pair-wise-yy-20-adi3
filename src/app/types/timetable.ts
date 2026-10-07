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
  // 实绩（车站上报的实际到发）。缺省表示该站未上报实绩，界面按计划值兼容显示。
  actualArrival?: number;
  actualDeparture?: number;
  actualBatch?: number;
  actualReporter?: string;
  actualReportedAt?: string;
}

/** 一条实绩上报记录（已入库或待补交）。 */
export interface ActualReportRecord {
  trainId: string;
  stationId: string;
  actualArrival: number;
  actualDeparture: number;
  batch: number;
  reporter: string;
  reportedAt: string;
}

/** 上报失败后留住待补交的实绩记录。 */
export interface PendingActualReport extends ActualReportRecord {
  id: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** 未生效的上报差异：先到的批次生效，后到的旧/重批次保留差异供核对。 */
export interface ActualDifference {
  id: string;
  trainId: string;
  stationId: string;
  winnerBatch: number;
  loserBatch: number;
  loserActualArrival: number;
  loserActualDeparture: number;
  loserReporter: string;
  // duplicate：同一批次重复上报；stale：晚到的旧批次。
  reason: 'duplicate' | 'stale';
  recordedAt: string;
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
  // 口径：actual 表示相关车站已上报实绩、按实际到发计算；planned 表示按计划时刻计算。
  basis: 'planned' | 'actual';
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
  // 上报失败后留住待补交的实绩记录。
  pendingReports: PendingActualReport[];
  // 未生效的上报差异（先到生效，后到保留差异）。
  actualDifferences: ActualDifference[];
}

export interface ImportedNetworkFile {
  lineName?: string;
  stations?: Station[];
  sections?: RailSection[];
  trains?: Train[];
}

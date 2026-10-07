import {
  ActualDiscrepancy,
  ActualReportBatch,
  ImportedNetworkFile,
  RailSection,
  Station,
  TimetableConflict,
  Train,
  TrainNetwork,
  TrainStop,
} from '../types/timetable';

const COLORS = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f'];
const STATION_NAMES = [
  '北岭',
  '清河',
  '松江',
  '东港',
  '西陵',
  '南川',
  '云台',
  '临江',
  '白塔',
  '海州',
  '新城',
  '终点南',
];
const SHORT_NAMES = ['BL', 'QH', 'SJ', 'DG', 'XL', 'NC', 'YT', 'LJ', 'BT', 'HZ', 'XC', 'ZD'];

export function createMockNetwork(): TrainNetwork {
  const stations: Station[] = STATION_NAMES.map((name, index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`,
    name,
    shortName: SHORT_NAMES[index],
    km: index * 31 + (index > 5 ? 2 : 0),
    tracks: [
      { id: `S${String(index + 1).padStart(2, '0')}-1`, name: 'I道', main: true },
      { id: `S${String(index + 1).padStart(2, '0')}-2`, name: 'II道', main: true },
      ...(index % 3 === 0
        ? [{ id: `S${String(index + 1).padStart(2, '0')}-3`, name: '3道', main: false }]
        : []),
    ],
  }));

  const sections: RailSection[] = stations.slice(0, -1).map((station, index) => {
    const next = stations[index + 1];
    const distanceKm = next.km - station.km;
    return {
      id: `SEC-${index + 1}`,
      fromStationId: station.id,
      toStationId: next.id,
      distanceKm,
      minHeadwayMin: distanceKm > 32 ? 5 : 4,
      baseRunningMin: Math.round(distanceKm * 1.35),
    };
  });

  const trains: Train[] = [];
  const categories: Train['category'][] = ['高铁', '动车', '普速', '货运'];
  const startTimes = [330, 390, 450, 510, 570, 630, 690];

  startTimes.forEach((baseStart, routeIndex) => {
    for (let offset = 0; offset < 38; offset += 1) {
      const direction = (offset + routeIndex) % 2 === 0 ? 'up' : 'down';
      const category = categories[(offset + routeIndex) % categories.length];
      const numberPrefix = category === '高铁' ? 'G' : category === '动车' ? 'D' : category === '货运' ? 'X' : 'K';
      const trainIndex = routeIndex * 38 + offset + 1;
      const departureBase = baseStart + offset * 7 + routeIndex * 3;
      trains.push(
        buildTrain({
          index: trainIndex,
          number: `${numberPrefix}${1200 + trainIndex}`,
          category,
          direction,
          departureBase,
          stations,
          sections,
        }),
      );
    }
  });

  applyMeetRelations(trains, stations);
  return { lineName: '江海铁路调度台 · 北岭—终点南', stations, sections, trains };
}

interface BuildTrainInput {
  index: number;
  number: string;
  category: Train['category'];
  direction: Train['direction'];
  departureBase: number;
  stations: Station[];
  sections: RailSection[];
}

function buildTrain(input: BuildTrainInput): Train {
  const speedFactor: Record<Train['category'], number> = {
    高铁: 0.76,
    动车: 0.86,
    普速: 1,
    货运: 1.18,
  };
  const orderedStations = input.direction === 'up' ? input.stations : [...input.stations].reverse();
  const orderedSections = input.direction === 'up' ? input.sections : [...input.sections].reverse();
  const stops: TrainStop[] = [];
  let cursor = input.departureBase;

  orderedStations.forEach((station, stationIndex) => {
    const isTerminal = stationIndex === 0 || stationIndex === orderedStations.length - 1;
    const skip = !isTerminal && (stationIndex + input.index) % 5 === 0;
    const dwell = isTerminal ? 4 : skip ? 0 : 3 + ((stationIndex + input.index) % 6);
    const arrival = stationIndex === 0 ? cursor : cursor;
    if (stationIndex > 0) {
      const section = orderedSections[stationIndex - 1];
      cursor += Math.max(2, Math.round(section.baseRunningMin * speedFactor[input.category]));
    }
    const actualArrival = stationIndex === 0 ? cursor : cursor;
    const departure = actualArrival + dwell;
    const track = station.tracks[input.index % station.tracks.length];
    stops.push({
      stationId: station.id,
      kind: skip ? 'pass' : 'stop',
      arrival: actualArrival,
      departure,
      trackId: track.id,
    });
    cursor = departure;
  });

  return {
    id: `T${input.index}`,
    number: input.number,
    category: input.category,
    direction: input.direction,
    color: COLORS[input.index % COLORS.length],
    selected: false,
    stops,
  };
}

function applyMeetRelations(trains: Train[], stations: Station[]): void {
  for (let index = 0; index < Math.min(trains.length, 180); index += 1) {
    const train = trains[index];
    const counterpart = trains[(index + 11) % trains.length];
    if (!train || !counterpart || train.direction === counterpart.direction) continue;
    const station = stations[(index * 3) % stations.length];
    const stop = train.stops.find((item) => item.stationId === station.id);
    if (stop && stop.kind === 'stop' && index % 4 === 0) {
      stop.kind = 'meet';
      stop.meetTrainNumber = counterpart.number;
    }
    const otherStop = counterpart.stops.find((item) => item.stationId === station.id);
    if (otherStop && otherStop.kind === 'stop' && index % 5 === 0) {
      otherStop.kind = 'meet';
      otherStop.meetTrainNumber = train.number;
    }
  }
}

export function normalizeImportedNetwork(file: ImportedNetworkFile, fallback: TrainNetwork): TrainNetwork {
  if (!Array.isArray(file.stations) || file.stations.length < 2) {
    throw new Error('JSON 数据缺少有效 stations 数组');
  }
  if (!Array.isArray(file.sections) || file.sections.length < 1) {
    throw new Error('JSON 数据缺少有效 sections 数组');
  }
  if (!Array.isArray(file.trains) || file.trains.length < 1) {
    throw new Error('JSON 数据缺少有效 trains 数组');
  }
  const stationIds = new Set(file.stations.map((station) => station.id));
  file.sections.forEach((section) => {
    if (!stationIds.has(section.fromStationId) || !stationIds.has(section.toStationId)) {
      throw new Error(`区间 ${section.id} 引用了不存在的车站`);
    }
  });
  return {
    lineName: file.lineName || fallback.lineName,
    stations: file.stations,
    sections: file.sections,
    trains: file.trains.map((train, index) => ({
      ...train,
      id: train.id || `IMPORT-${index + 1}`,
      color: train.color || COLORS[index % COLORS.length],
      selected: false,
    })),
  };
}

export function filterTrains(network: TrainNetwork, query: string, categories: string[], direction: string): Train[] {
  const normalizedQuery = query.trim().toLowerCase();
  return network.trains.filter((train) => {
    const queryMatches = !normalizedQuery || train.number.toLowerCase().includes(normalizedQuery);
    const categoryMatches = categories.length === 0 || categories.includes(train.category);
    const directionMatches = direction === 'all' || train.direction === direction;
    return queryMatches && categoryMatches && directionMatches;
  });
}

export function shiftTrain(train: Train, deltaMinutes: number): Train {
  return {
    ...train,
    stops: train.stops.map((stop) => ({
      ...stop,
      arrival: stop.arrival + deltaMinutes,
      departure: stop.departure + deltaMinutes,
    })),
  };
}

/** 该站是否已有确认的实绩到发 */
export function hasActualReport(stop: TrainStop): boolean {
  return stop.actualArrival != null || stop.actualDeparture != null;
}

/** 实绩口径到达时刻：已上报用实绩，未上报按计划 */
export function effectiveArrival(stop: TrainStop): number {
  return stop.actualArrival ?? stop.arrival;
}

/** 实绩口径发车时刻：已上报用实绩，未上报按计划 */
export function effectiveDeparture(stop: TrainStop): number {
  return stop.actualDeparture ?? stop.departure;
}

export interface ActualBatchOutcome {
  trains: Train[];
  confirmed: number;
  corrected: number;
  stale: number;
  invalid: number;
  discrepancies: ActualDiscrepancy[];
}

/**
 * 把一个上报批次落到运行线上（纯函数，reducer 调用）。
 * 规则：
 * - 无实绩的站直接确认；
 * - 批次序号更新（更大）则更正既有实绩；
 * - 序号相同（两位值班员同时提交）先到生效，后到的不同值保留为差异；
 * - 序号更小的晚到旧批次不倒退已确认结论。
 */
export function applyActualBatch(network: TrainNetwork, batch: ActualReportBatch): ActualBatchOutcome {
  const outcome: ActualBatchOutcome = {
    trains: network.trains,
    confirmed: 0,
    corrected: 0,
    stale: 0,
    invalid: 0,
    discrepancies: [],
  };
  const entriesByTrain = new Map<string, ActualReportBatch['entries']>();
  batch.entries.forEach((entry) => {
    const bucket = entriesByTrain.get(entry.trainId) ?? [];
    bucket.push(entry);
    entriesByTrain.set(entry.trainId, bucket);
  });

  outcome.trains = network.trains.map((train) => {
    const entries = entriesByTrain.get(train.id);
    if (!entries || entries.length === 0) return train;
    const matched = new Set<string>();
    let changed = false;
    const stops = train.stops.map((stop) => {
      const entry = entries.find((candidate) => candidate.stationId === stop.stationId);
      if (!entry) return stop;
      matched.add(stop.stationId);
      if (entry.actualArrival == null && entry.actualDeparture == null) {
        outcome.invalid += 1;
        return stop;
      }
      const next: TrainStop = {
        ...stop,
        // 只登记本批次真正上报的字段，未上报的保持原值（显示层再回退计划值）
        actualArrival: entry.actualArrival ?? stop.actualArrival,
        actualDeparture: entry.actualDeparture ?? stop.actualDeparture,
        actualBatchId: batch.batchId,
        actualSequence: batch.sequence,
        actualOperator: batch.operator,
        actualReportedAt: batch.submittedAt,
      };
      if (!hasActualReport(stop)) {
        outcome.confirmed += 1;
        changed = true;
        return next;
      }
      const currentSequence = stop.actualSequence ?? Number.MIN_SAFE_INTEGER;
      if (batch.sequence > currentSequence) {
        outcome.corrected += 1;
        changed = true;
        return next;
      }
      if (batch.sequence === currentSequence && stop.actualBatchId !== batch.batchId) {
        const differs =
          (entry.actualArrival != null && entry.actualArrival !== (stop.actualArrival ?? null)) ||
          (entry.actualDeparture != null && entry.actualDeparture !== (stop.actualDeparture ?? null));
        if (differs) {
          outcome.discrepancies.push({
            id: `${batch.batchId}:${train.id}:${stop.stationId}`,
            trainId: train.id,
            stationId: stop.stationId,
            kept: {
              actualArrival: stop.actualArrival,
              actualDeparture: stop.actualDeparture,
              operator: stop.actualOperator ?? '—',
              batchId: stop.actualBatchId ?? '—',
              sequence: currentSequence,
            },
            incoming: {
              actualArrival: entry.actualArrival,
              actualDeparture: entry.actualDeparture,
              operator: batch.operator,
              batchId: batch.batchId,
              sequence: batch.sequence,
            },
            recordedAt: batch.submittedAt,
          });
        }
        return stop;
      }
      outcome.stale += 1;
      return stop;
    });
    entries.forEach((entry) => {
      if (!matched.has(entry.stationId)) outcome.invalid += 1;
    });
    return changed ? { ...train, stops } : train;
  });

  const knownTrainIds = new Set(network.trains.map((train) => train.id));
  batch.entries.forEach((entry) => {
    if (!knownTrainIds.has(entry.trainId)) outcome.invalid += 1;
  });
  return outcome;
}

export function updateStop(train: Train, stationId: string, changes: Partial<TrainStop>): Train {
  return {
    ...train,
    stops: train.stops.map((stop) => (stop.stationId === stationId ? { ...stop, ...changes } : stop)),
  };
}

export function getSectionEndpoints(section: RailSection, network: TrainNetwork): [Station, Station] | null {
  const from = network.stations.find((station) => station.id === section.fromStationId);
  const to = network.stations.find((station) => station.id === section.toStationId);
  return from && to ? [from, to] : null;
}

export function computeConflicts(network: TrainNetwork, visibleTrainIds?: Set<string>): TimetableConflict[] {
  // 实绩口径：已上报车站用实际到发，未上报按计划时刻；实绩更新后此处整体重算，
  // 未受影响的列车时刻不变，其冲突结论自然保留。
  const conflicts: TimetableConflict[] = [];
  const stationMap = new Map(network.stations.map((station) => [station.id, station]));
  const sectionMap = new Map(network.sections.map((section) => [section.id, section]));
  const stationOccupancy = new Map<string, Array<{ train: Train; stop: TrainStop }>>();

  network.trains.forEach((train) => {
    if (visibleTrainIds && !visibleTrainIds.has(train.id)) return;
    train.stops.forEach((stop, stopIndex) => {
      const key = `${stop.stationId}:${stop.trackId}`;
      const bucket = stationOccupancy.get(key) ?? [];
      bucket.push({ train, stop });
      stationOccupancy.set(key, bucket);

      const nextStop = train.stops[stopIndex + 1];
      if (!nextStop) return;
      const section = network.sections.find(
        (candidate) =>
          (candidate.fromStationId === stop.stationId && candidate.toStationId === nextStop.stationId) ||
          (candidate.toStationId === stop.stationId && candidate.fromStationId === nextStop.stationId),
      );
      if (!section) return;
      const departure = Math.min(effectiveDeparture(stop), effectiveArrival(nextStop));
      const arrival = Math.max(effectiveDeparture(stop), effectiveArrival(nextStop));
      const peers = network.trains.filter(
        (candidate) =>
          candidate.id !== train.id &&
          candidate.direction === train.direction &&
          (!visibleTrainIds || visibleTrainIds.has(candidate.id)),
      );
      peers.forEach((peer) => {
        const peerStopsInOrder =
          peer.stops.findIndex((item) => item.stationId === stop.stationId) <
          peer.stops.findIndex((item) => item.stationId === nextStop.stationId);
        if (!peerStopsInOrder) return;
        const peerStart = peer.stops.find((item) => item.stationId === stop.stationId);
        const peerEnd = peer.stops.find((item) => item.stationId === nextStop.stationId);
        if (!peerStart || !peerEnd) return;
        const peerDeparture = Math.min(effectiveDeparture(peerStart), effectiveArrival(peerEnd));
        const peerArrival = Math.max(effectiveDeparture(peerStart), effectiveArrival(peerEnd));
        const gap = Math.abs(peerDeparture - departure);
        if (gap < section.minHeadwayMin) {
          conflicts.push({
            id: `headway:${section.id}:${train.id}:${peer.id}`,
            type: 'headway',
            severity: gap < section.minHeadwayMin * 0.55 ? 'danger' : 'warning',
            title: `${sectionMap.get(section.id)?.id ?? section.id} 追踪间隔不足`,
            detail: `${train.number} 与 ${peer.number} 在${stationMap.get(stop.stationId)?.name}—${stationMap.get(nextStop.stationId)?.name}区间发车相差 ${gap.toFixed(1)} 分，要求不少于 ${section.minHeadwayMin} 分。`,
            trainIds: [train.id, peer.id],
            sectionId: section.id,
            timeRange: { start: Math.min(departure, peerDeparture), end: Math.max(arrival, peerArrival) },
            suggestedShift: {
              start: Math.max(1, section.minHeadwayMin - gap),
              end: Math.max(4, section.minHeadwayMin - gap + 10),
            },
          });
        }

        const highSpeedAhead =
          departure < peerDeparture &&
          arrival > peerArrival &&
          (train.category === '高铁' || train.category === '动车') &&
          (peer.category === '普速' || peer.category === '货运');
        if (highSpeedAhead) {
          conflicts.push({
            id: `overtake:${section.id}:${train.id}:${peer.id}`,
            type: 'overtake',
            severity: 'warning',
            title: `${train.number} 将在区间追及 ${peer.number}`,
            detail: `${train.category}列车在${stationMap.get(stop.stationId)?.name}—${stationMap.get(nextStop.stationId)?.name}区间形成越行风险，建议在前方站安排会让或调整发车时刻。`,
            trainIds: [train.id, peer.id],
            sectionId: section.id,
            timeRange: { start: departure, end: arrival },
            suggestedShift: { start: 2, end: 12 },
          });
        }
      });
    });
  });

  stationOccupancy.forEach((occupants, key) => {
    occupants.sort((a, b) => effectiveArrival(a.stop) - effectiveArrival(b.stop));
    for (let index = 1; index < occupants.length; index += 1) {
      const previous = occupants[index - 1];
      const current = occupants[index];
      const gap = effectiveArrival(current.stop) - effectiveDeparture(previous.stop);
      if (gap < 2) {
        const [stationId, trackId] = key.split(':');
        const station = stationMap.get(stationId);
        const track = station?.tracks.find((candidate) => candidate.id === trackId);
        conflicts.push({
          id: `track:${stationId}:${trackId}:${previous.train.id}:${current.train.id}`,
          type: 'track',
          severity: gap < 0 ? 'danger' : 'warning',
          title: `${station?.name ?? stationId} ${track?.name ?? trackId} 占用冲突`,
          detail: `${previous.train.number} 与 ${current.train.number} 的到发线占用重叠 ${Math.max(0, -gap).toFixed(1)} 分，需要改股道或错开时刻。`,
          trainIds: [previous.train.id, current.train.id],
          stationId,
          timeRange: {
            start: Math.min(effectiveArrival(previous.stop), effectiveArrival(current.stop)),
            end: Math.max(effectiveDeparture(previous.stop), effectiveDeparture(current.stop)),
          },
          suggestedShift: { start: Math.max(1, 2 - gap), end: Math.max(5, 8 - gap) },
        });
      }
    }
  });

  return conflicts
    .filter((conflict, index, all) => all.findIndex((item) => item.id === conflict.id) === index)
    .sort((a, b) => a.timeRange.start - b.timeRange.start)
    .slice(0, 400);
}

export function visibleTimeRange(network: TrainNetwork): [number, number] {
  const times = network.trains.flatMap((train) =>
    train.stops.flatMap((stop) => [effectiveArrival(stop), effectiveDeparture(stop)]),
  );
  if (times.length === 0) return [0, 1440];
  return [Math.min(...times) - 10, Math.max(...times) + 10];
}

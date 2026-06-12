import { Test, type TestingModule } from '@nestjs/testing';
import { SnapshotService } from '../../../common/snapshot.service';
import { isJobSnapshotEntry, type JobSnapshotEntry, type JobVacancy } from '../dto/job-vacancy.dto';
import { GszParserService } from '../gsz-parser.service';
import { MostyJobsNotifierService } from '../mosty-jobs-notifier.service';
import { MostyJobsService } from '../mosty-jobs.service';
import { RabotaParserService } from '../rabota-parser.service';

const gszVacancy: JobVacancy = {
  url: 'https://gsz.gov.by/registration/employer/vacancy/1/detail-public/',
  source: 'gsz',
  title: 'Педагог',
};

const rabotaVacancy: JobVacancy = {
  url: 'https://rabota.by/vacancy/2',
  source: 'rabota',
  title: 'Продавец',
};

// lastSeenAt must be recent — entries older than SNAPSHOT_RETENTION_DAYS are pruned.
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const asSnapshot = (v: JobVacancy): JobSnapshotEntry => ({
  ...v,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: yesterday,
});

describe('isJobSnapshotEntry', () => {
  it('returns true for a valid entry', () =>
    expect(isJobSnapshotEntry(asSnapshot(gszVacancy))).toBe(true));

  it('returns false for null', () => expect(isJobSnapshotEntry(null)).toBe(false));

  it('returns false for an unknown source', () =>
    expect(isJobSnapshotEntry({ ...asSnapshot(gszVacancy), source: 'other' })).toBe(false));

  it('returns false when timestamps are missing', () =>
    expect(isJobSnapshotEntry({ ...gszVacancy })).toBe(false));
});

describe('MostyJobsService — scrape', () => {
  let module: TestingModule;
  let service: MostyJobsService;
  let gszParser: jest.Mocked<GszParserService>;
  let rabotaParser: jest.Mocked<RabotaParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<MostyJobsNotifierService>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        MostyJobsService,
        { provide: GszParserService, useValue: { fetch: jest.fn() } },
        { provide: RabotaParserService, useValue: { fetch: jest.fn() } },
        { provide: SnapshotService, useValue: { read: jest.fn(), write: jest.fn() } },
        {
          provide: MostyJobsNotifierService,
          useValue: { notifyRunResult: jest.fn(), notifyError: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(MostyJobsService);
    gszParser = module.get(GszParserService);
    rabotaParser = module.get(RabotaParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(MostyJobsNotifierService);

    notifier.notifyRunResult.mockResolvedValue({ notifiedNew: new Set<string>() });
    snapshot.write.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  it('seeds both sources silently on the first run', async () => {
    gszParser.fetch.mockResolvedValue([gszVacancy]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([]);
    expect(result.seededCount).toBe(2);
    expect(snapshot.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ url: gszVacancy.url }),
        expect.objectContaining({ url: rabotaVacancy.url }),
      ]),
    );
  });

  it('reports only new vacancies once a source has history', async () => {
    const newGsz: JobVacancy = { ...gszVacancy, url: 'https://gsz.gov.by/new/', title: 'Новая' };
    gszParser.fetch.mockResolvedValue([gszVacancy, newGsz]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy), asSnapshot(rabotaVacancy)]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([newGsz]);
    expect(result.seededCount).toBe(0);
  });

  it('seeds a source without history even when the other has history', async () => {
    gszParser.fetch.mockResolvedValue([gszVacancy]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([asSnapshot(rabotaVacancy)]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([]);
    expect(result.seededCount).toBe(1);
  });

  it('persists a new vacancy only when its notification was delivered', async () => {
    const newGsz: JobVacancy = { ...gszVacancy, url: 'https://gsz.gov.by/new/', title: 'Новая' };
    const missedGsz: JobVacancy = {
      ...gszVacancy,
      url: 'https://gsz.gov.by/missed/',
      title: 'Пропущенная',
    };
    gszParser.fetch.mockResolvedValue([gszVacancy, newGsz, missedGsz]);
    rabotaParser.fetch.mockResolvedValue([]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy), asSnapshot(rabotaVacancy)]);
    notifier.notifyRunResult.mockResolvedValue({ notifiedNew: new Set([newGsz.url]) });

    await service.run();

    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    const urls = written.map(e => e.url);
    expect(urls).toContain(newGsz.url);
    expect(urls).not.toContain(missedGsz.url);
  });

  it('keeps snapshot entries of a failed source untouched', async () => {
    gszParser.fetch.mockResolvedValue(null);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy), asSnapshot(rabotaVacancy)]);

    const result = await service.run();

    expect(result.totalGsz).toBeNull();
    expect(result.newVacancies).toEqual([]);
    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).toContain(gszVacancy.url);
  });

  it('throws and notifies when both sources fail', async () => {
    gszParser.fetch.mockResolvedValue(null);
    rabotaParser.fetch.mockResolvedValue(null);
    snapshot.read.mockResolvedValue([]);

    await expect(service.run()).rejects.toThrow('Both sources failed');
    expect(notifier.notifyError).toHaveBeenCalled();
    expect(snapshot.write).not.toHaveBeenCalled();
  });

  it('keeps disappeared vacancies in the snapshot', async () => {
    gszParser.fetch.mockResolvedValue([]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy), asSnapshot(rabotaVacancy)]);

    await service.run();

    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).toContain(gszVacancy.url);
  });

  it('prunes entries not seen for longer than the retention window', async () => {
    const stale: JobSnapshotEntry = {
      ...asSnapshot(gszVacancy),
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    };
    gszParser.fetch.mockResolvedValue([]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([stale, asSnapshot(rabotaVacancy)]);

    await service.run();

    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).not.toContain(gszVacancy.url);
    expect(written.map(e => e.url)).toContain(rabotaVacancy.url);
  });
});

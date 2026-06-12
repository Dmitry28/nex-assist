import { Test, type TestingModule } from '@nestjs/testing';
import { SnapshotService } from '../../../common/snapshot.service';
import { isJobSnapshotEntry, type JobSnapshotEntry, type JobVacancy } from '../dto/job-vacancy.dto';
import { GszParserService } from '../gsz-parser.service';
import { JoblabParserService } from '../joblab-parser.service';
import { KufarJobsParserService } from '../kufar-jobs-parser.service';
import { MostyJobsNotifierService } from '../mosty-jobs-notifier.service';
import { MostyJobsService } from '../mosty-jobs.service';
import { RabotaParserService } from '../rabota-parser.service';

const gszVacancy: JobVacancy = {
  url: 'https://gsz.gov.by/registration/employer/vacancy/1/detail-public/',
  source: 'gsz',
  title: 'Педагог',
  employer: 'Школа',
};

const rabotaVacancy: JobVacancy = {
  url: 'https://rabota.by/vacancy/2',
  source: 'rabota',
  title: 'Продавец',
  employer: 'Санта',
};

const joblabVacancy: JobVacancy = {
  url: 'https://joblab.by/vacancy/3',
  source: 'joblab',
  title: 'Кассир',
  employer: 'Евроопт',
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

  it('accepts all known sources', () => {
    for (const source of ['gsz', 'rabota', 'joblab', 'kufar']) {
      expect(isJobSnapshotEntry({ ...asSnapshot(gszVacancy), source })).toBe(true);
    }
  });

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
  let joblabParser: jest.Mocked<JoblabParserService>;
  let kufarParser: jest.Mocked<KufarJobsParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<MostyJobsNotifierService>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        MostyJobsService,
        { provide: GszParserService, useValue: { fetch: jest.fn() } },
        { provide: RabotaParserService, useValue: { fetch: jest.fn() } },
        { provide: JoblabParserService, useValue: { fetch: jest.fn() } },
        { provide: KufarJobsParserService, useValue: { fetch: jest.fn() } },
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
    joblabParser = module.get(JoblabParserService);
    kufarParser = module.get(KufarJobsParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(MostyJobsNotifierService);

    // Defaults: commercial sources empty/ok — individual tests override.
    gszParser.fetch.mockResolvedValue([]);
    rabotaParser.fetch.mockResolvedValue([]);
    joblabParser.fetch.mockResolvedValue([]);
    kufarParser.fetch.mockResolvedValue([]);
    notifier.notifyRunResult.mockResolvedValue({ notifiedNew: new Set<string>() });
    snapshot.write.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  it('seeds all sources silently on the first run', async () => {
    gszParser.fetch.mockResolvedValue([gszVacancy]);
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    joblabParser.fetch.mockResolvedValue([joblabVacancy]);
    snapshot.read.mockResolvedValue([]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([]);
    expect(result.seededCount).toBe(3);
    expect(snapshot.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ url: gszVacancy.url }),
        expect.objectContaining({ url: rabotaVacancy.url }),
        expect.objectContaining({ url: joblabVacancy.url }),
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

  it('seeds a source without history even when others have history', async () => {
    gszParser.fetch.mockResolvedValue([gszVacancy]);
    joblabParser.fetch.mockResolvedValue([joblabVacancy]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy)]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([]);
    expect(result.seededCount).toBe(1);
  });

  it('silences a cross-source duplicate of a known vacancy and persists it', async () => {
    // joblab re-publishes the gsz vacancy under a slightly different title.
    const joblabDup: JobVacancy = {
      url: 'https://joblab.by/vacancy/9',
      source: 'joblab',
      title: 'Педагог (г. Мосты)',
      employer: 'Школа',
    };
    joblabParser.fetch.mockResolvedValue([joblabDup]);
    snapshot.read.mockResolvedValue([
      asSnapshot(gszVacancy),
      asSnapshot({ ...rabotaVacancy, source: 'joblab', url: 'https://joblab.by/vacancy/8' }),
    ]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([]);
    expect(result.duplicateCount).toBe(1);
    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).toContain(joblabDup.url);
  });

  it('silences an in-run duplicate, keeping the higher-priority source', async () => {
    const newGsz: JobVacancy = {
      ...gszVacancy,
      url: 'https://gsz.gov.by/new/',
      title: 'Кассир',
      employer: 'Евроопт',
    };
    const joblabDup: JobVacancy = {
      url: 'https://joblab.by/vacancy/9',
      source: 'joblab',
      title: 'Кассир',
      employer: 'ООО "Евроопт"',
    };
    gszParser.fetch.mockResolvedValue([gszVacancy, newGsz]);
    joblabParser.fetch.mockResolvedValue([joblabDup]);
    snapshot.read.mockResolvedValue([
      asSnapshot(gszVacancy),
      asSnapshot({ ...rabotaVacancy, source: 'joblab', url: 'https://joblab.by/vacancy/8' }),
    ]);

    const result = await service.run();

    expect(result.newVacancies).toEqual([newGsz]);
    expect(result.duplicateCount).toBe(1);
  });

  it('persists a new vacancy only when its notification was delivered', async () => {
    const newGsz: JobVacancy = { ...gszVacancy, url: 'https://gsz.gov.by/new/', title: 'Новая' };
    const missedGsz: JobVacancy = {
      ...gszVacancy,
      url: 'https://gsz.gov.by/missed/',
      title: 'Пропущенная',
    };
    gszParser.fetch.mockResolvedValue([gszVacancy, newGsz, missedGsz]);
    snapshot.read.mockResolvedValue([asSnapshot(gszVacancy)]);
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

    expect(result.totals.gsz).toBeNull();
    expect(result.newVacancies).toEqual([]);
    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).toContain(gszVacancy.url);
  });

  it('throws and notifies when all sources fail', async () => {
    for (const p of [gszParser, rabotaParser, joblabParser, kufarParser]) {
      p.fetch.mockResolvedValue(null);
    }
    snapshot.read.mockResolvedValue([]);

    await expect(service.run()).rejects.toThrow('All vacancy sources failed');
    expect(notifier.notifyError).toHaveBeenCalled();
    expect(snapshot.write).not.toHaveBeenCalled();
  });

  it('keeps disappeared vacancies in the snapshot', async () => {
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
    rabotaParser.fetch.mockResolvedValue([rabotaVacancy]);
    snapshot.read.mockResolvedValue([stale, asSnapshot(rabotaVacancy)]);

    await service.run();

    const written = snapshot.write.mock.calls[0][1] as JobSnapshotEntry[];
    expect(written.map(e => e.url)).not.toContain(gszVacancy.url);
    expect(written.map(e => e.url)).toContain(rabotaVacancy.url);
  });
});

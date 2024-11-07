// src/social-media/social-media.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SocialMediaService } from './social-media.service';
import { SocialMediaRepository } from './social-media.repository';
import { MetricsService } from '../metric/metric.service';

describe('SocialMediaService - Private Methods', () => {
  let service: SocialMediaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialMediaService,
        {
          provide: SocialMediaRepository,
          useValue: {},
        },
        {
          provide: MetricsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<SocialMediaService>(SocialMediaService);
  });

  describe('calculateBackoffDelay', () => {
    test.each([0, 1, 2, 3])(
      'should calculate correct delay for attempt %i',
      (attempt) => {
        jest.spyOn(Math, 'random').mockReturnValue(0.5); // Mock random to 0.5
        const delay = service['calculateBackoffDelay'](attempt);
        expect(delay).toBe(1000 * Math.pow(2, attempt) + 500); // baseDelay + 500
      },
    );

    it('should return a delay greater than base delay for any attempt', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0); // Mock random to 0
      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = service['calculateBackoffDelay'](attempt);
        expect(delay).toBeGreaterThanOrEqual(1000 * Math.pow(2, attempt));
        expect(delay).toBeLessThan(1000 * Math.pow(2, attempt + 1));
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });
  });

  describe('extractCompleteArraysFromBuffer', () => {
    it('should extract complete JSON arrays from dataBuffer', () => {
      service['dataBuffer'] =
        '[{"id":"1","text":"Tweet 1"}][{"id":"2","text":"Tweet 2"}]Incomplete';

      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([
        { id: '1', text: 'Tweet 1' },
        { id: '2', text: 'Tweet 2' },
      ]);

      // dataBuffer should contain the incomplete part
      expect(service['dataBuffer']).toBe('Incomplete');
    });

    it('should handle incomplete JSON arrays and wait for more data', () => {
      service['dataBuffer'] = '[{"id":"1","text":"Tweet 1"}';
      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([]); // Should return empty array
      expect(service['dataBuffer']).toBe('[{"id":"1","text":"Tweet 1"}'); // Buffer remains unchanged
    });

    it('should extract multiple arrays from dataBuffer', () => {
      service['dataBuffer'] =
        '[{"id":"1","text":"Tweet 1"}][{"id":"2","text":"Tweet 2"}][{"id":"3","text":"Tweet 3"}]';

      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([
        { id: '1', text: 'Tweet 1' },
        { id: '2', text: 'Tweet 2' },
        { id: '3', text: 'Tweet 3' },
      ]);

      expect(service['dataBuffer']).toBe(''); // Buffer should be empty
    });

    it('should handle malformed JSON and continue processing', () => {
      service['dataBuffer'] =
        '[{"id":"1","text":"Tweet 1"}][Malformed JSON][{"id":"2","text":"Tweet 2"}]';

      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([{ id: '1', text: 'Tweet 1' }]);
      expect(service['dataBuffer']).toBe(
        '[Malformed JSON][{"id":"2","text":"Tweet 2"}]',
      );
    });

    it('should handle empty dataBuffer gracefully', () => {
      service['dataBuffer'] = '';

      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([]);
      expect(service['dataBuffer']).toBe('');
    });

    it('should handle dataBuffer with only incomplete JSON array', () => {
      service['dataBuffer'] = '[{"id":"1","text":"Tweet 1"},';

      const tweetsList = service['extractCompleteArraysFromBuffer']();

      expect(tweetsList).toEqual([]);
      expect(service['dataBuffer']).toBe('[{"id":"1","text":"Tweet 1"},');
    });

    it('should process dataBuffer after multiple calls', () => {
      service['dataBuffer'] = '[{"id":"1","text":"Tweet 1"},';

      let tweetsList = service['extractCompleteArraysFromBuffer']();
      expect(tweetsList).toEqual([]);
      expect(service['dataBuffer']).toBe('[{"id":"1","text":"Tweet 1"},');

      // Append more data to complete the JSON array
      service['dataBuffer'] += '{"id":"2","text":"Tweet 2"}]ExtraData';

      tweetsList = service['extractCompleteArraysFromBuffer']();
      expect(tweetsList).toEqual([
        { id: '1', text: 'Tweet 1' },
        { id: '2', text: 'Tweet 2' },
      ]);
      expect(service['dataBuffer']).toBe('ExtraData');
    });
  });
});

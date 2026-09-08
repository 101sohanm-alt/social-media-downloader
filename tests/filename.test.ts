import { describe, it, expect } from 'vitest';
import { sanitizeFilename, formatFilename } from '../src/shared/filename';

describe('Filename Utilities', () => {
  it('sanitizes forbidden characters from author and title', () => {
    const raw = 'My Great / Post: "Why *Cats* <Are> Best? | No. 1"\\Test\x00\x1f\n\r\t';
    const sanitized = sanitizeFilename(raw);
    expect(sanitized).not.toMatch(/[/\\:*?"<>|\x00-\x1f]/);
    expect(sanitized).toBe('My Great _ Post_ _Why _Cats_ _Are_ Best_ _ No. 1__Test');
  });

  it('interpolates tokens correctly', () => {
    const template = '[{platform}] {author} - {id}_{index}';
    const filename = formatFilename(template, {
      platform: 'twitter',
      author: 'elonmusk',
      id: '123456789',
      index: 2,
      total: 4,
      ext: '.jpg',
    });

    expect(filename).toBe('[twitter] elonmusk - 123456789_2.jpg');
  });

  it('interpolates date token correctly', () => {
    const template = '{platform}_{id}_{date}';
    const fixedDate = new Date('2025-05-15T12:00:00Z');
    const filename = formatFilename(template, {
      platform: 'reddit',
      id: 'abc123z',
      date: fixedDate,
      ext: '.mp4',
    });

    expect(filename).toBe('reddit_abc123z_2025-05-15.mp4');
  });

  it('automatically appends index when total > 1 and index is not in template', () => {
    const template = '{platform}_{author}_{id}';
    const filename = formatFilename(template, {
      platform: 'instagram',
      author: 'natgeo',
      id: 'Cxyz',
      index: 3,
      total: 5,
      ext: '.jpg',
    });

    expect(filename).toBe('instagram_natgeo_Cxyz_3.jpg');
  });

  it('truncates long filenames safely while preserving extension', () => {
    const longTitle = 'a'.repeat(300);
    const template = '{title}';
    const filename = formatFilename(
      template,
      {
        platform: 'reddit',
        id: 'post99',
        title: longTitle,
        ext: '.mp4',
      },
      120 // max base length 120
    );

    expect(filename.endsWith('.mp4')).toBe(true);
    expect(filename.length).toBeLessThanOrEqual(124); // 120 + 4 (.mp4)
  });

  it('falls back gracefully when tokens are missing', () => {
    const template = '{platform}_{author}_{id}';
    const filename = formatFilename(template, {
      platform: 'twitter',
      id: '999',
      ext: '.jpg',
    });

    // When author is undefined, it shouldn't be literal undefined
    expect(filename).not.toContain('undefined');
    expect(filename).toBe('twitter_unknown_999.jpg');
  });
});

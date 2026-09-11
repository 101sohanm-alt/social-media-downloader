import { describe, it, expect } from 'vitest';
import { parseTwitterMedia } from '../src/parsers/twitterParser';

describe('Twitter / X Media Parser', () => {
  it('extracts high-res orig URL from tweet photo entities', () => {
    const mockTweet = {
      id_str: '1234567890',
      user: { screen_name: 'jack' },
      extended_entities: {
        media: [
          {
            id_str: '111222333',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/F123456789.jpg',
            sizes: {
              large: { w: 2048, h: 1536 },
            },
          },
        ],
      },
    };

    const result = parseTwitterMedia(mockTweet);
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('twitter');
    expect(result[0].type).toBe('image');
    expect(result[0].author).toBe('jack');
    expect(result[0].id).toBe('1234567890');
    // Must request original quality (?format=jpg&name=orig)
    expect(result[0].url).toBe('https://pbs.twimg.com/media/F123456789?format=jpg&name=orig');
  });

  it('selects highest bitrate MP4 from video variants and ignores HLS/m3u8', () => {
    const mockTweet = {
      id_str: '999888777',
      user: { screen_name: 'elonmusk' },
      extended_entities: {
        media: [
          {
            id_str: '888777666',
            type: 'video',
            video_info: {
              aspect_ratio: [16, 9],
              variants: [
                {
                  content_type: 'application/x-mpegURL',
                  url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/playlist.m3u8',
                },
                {
                  bitrate: 256000,
                  content_type: 'video/mp4',
                  url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/320x180/low.mp4',
                },
                {
                  bitrate: 2176000,
                  content_type: 'video/mp4',
                  url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4',
                },
                {
                  bitrate: 832000,
                  content_type: 'video/mp4',
                  url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/med.mp4',
                },
              ],
            },
          },
        ],
      },
    };

    const result = parseTwitterMedia(mockTweet);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('video');
    expect(result[0].bitrate).toBe(2176000);
    expect(result[0].url).toBe('https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4');
  });

  it('extracts all images from multi-photo tweet with index numbering', () => {
    const mockTweet = {
      id_str: '4567890123',
      user: { screen_name: 'natgeo' },
      extended_entities: {
        media: [
          {
            id_str: 'm1',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/pic1.png',
          },
          {
            id_str: 'm2',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/pic2.jpg',
          },
          {
            id_str: 'm3',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/pic3.webp',
          },
          {
            id_str: 'm4',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/pic4.jpeg',
          },
        ],
      },
    };

    const result = parseTwitterMedia(mockTweet);
    expect(result).toHaveLength(4);
    expect(result[0].index).toBe(1);
    expect(result[0].total).toBe(4);
    expect(result[0].url).toBe('https://pbs.twimg.com/media/pic1?format=png&name=orig');
    expect(result[1].index).toBe(2);
    expect(result[1].url).toBe('https://pbs.twimg.com/media/pic2?format=jpg&name=orig');
    expect(result[3].index).toBe(4);
    expect(result[3].url).toBe('https://pbs.twimg.com/media/pic4?format=jpeg&name=orig');
  });

  it('handles nested GraphQL tweet detail payload', () => {
    const mockGraphQLResponse = {
      data: {
        tweetResult: {
          result: {
            __typename: 'Tweet',
            rest_id: '1799988877',
            core: {
              user_results: {
                result: {
                  legacy: {
                    screen_name: 'test_user',
                  },
                },
              },
            },
            legacy: {
              id_str: '1799988877',
              full_text: 'Check out this photo!',
              extended_entities: {
                media: [
                  {
                    id_str: 'm99',
                    type: 'photo',
                    media_url_https: 'https://pbs.twimg.com/media/nested.jpg',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = parseTwitterMedia(mockGraphQLResponse);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1799988877');
    expect(result[0].author).toBe('test_user');
    expect(result[0].url).toBe('https://pbs.twimg.com/media/nested?format=jpg&name=orig');
  });

  it('extracts media from entries[1] when entries[0] is a text-only tweet in a timeline response', () => {
    const timelinePayload = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: 'tweet-111111111',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: '111111111',
                            legacy: {
                              id_str: '111111111',
                              full_text: 'Just text, no media',
                              user: { screen_name: 'textonly_user' },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'tweet-222222222',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: '222222222',
                            core: {
                              user_results: {
                                result: {
                                  legacy: { screen_name: 'photouser' },
                                },
                              },
                            },
                            legacy: {
                              id_str: '222222222',
                              full_text: 'Tweet with an image',
                              extended_entities: {
                                media: [
                                  {
                                    id_str: 'photo_entry_1',
                                    type: 'photo',
                                    media_url_https: 'https://pbs.twimg.com/media/timeline_photo.jpg',
                                  },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const result = parseTwitterMedia(timelinePayload);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('222222222');
    expect(result[0].author).toBe('photouser');
    expect(result[0].url).toBe('https://pbs.twimg.com/media/timeline_photo?format=jpg&name=orig');
  });

  it('extracts media items from all tweets in a multi-tweet feed', () => {
    const multiTweetFeed = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: 'tweet_101',
                          core: {
                            user_results: {
                              result: {
                                legacy: { screen_name: 'user_1' },
                              },
                            },
                          },
                          legacy: {
                            id_str: 'tweet_101',
                            extended_entities: {
                              media: [
                                {
                                  id_str: 'media_photo_1',
                                  type: 'photo',
                                  media_url_https: 'https://pbs.twimg.com/media/pic1.jpg',
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: 'tweet_102',
                          core: {
                            user_results: {
                              result: {
                                legacy: { screen_name: 'user_2' },
                              },
                            },
                          },
                          legacy: {
                            id_str: 'tweet_102',
                            extended_entities: {
                              media: [
                                {
                                  id_str: 'media_video_2',
                                  type: 'video',
                                  video_info: {
                                    variants: [
                                      {
                                        bitrate: 832000,
                                        content_type: 'video/mp4',
                                        url: 'https://video.twimg.com/feed_med.mp4',
                                      },
                                      {
                                        bitrate: 2176000,
                                        content_type: 'video/mp4',
                                        url: 'https://video.twimg.com/feed_high.mp4',
                                      },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const result = parseTwitterMedia(multiTweetFeed);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('tweet_101');
    expect(result[0].type).toBe('image');
    expect(result[0].url).toBe('https://pbs.twimg.com/media/pic1?format=jpg&name=orig');
    expect(result[1].id).toBe('tweet_102');
    expect(result[1].type).toBe('video');
    expect(result[1].bitrate).toBe(2176000);
    expect(result[1].url).toBe('https://video.twimg.com/feed_high.mp4');
  });

  it('extracts media from Twitter Syndication API JSON (photos, video.variants, mediaDetails)', () => {
    const syndicationPayload = {
      id_str: '1800000000000',
      text: 'Syndicated tweet',
      user: {
        screen_name: 'syndicated_dev',
      },
      photos: [
        {
          url: 'https://pbs.twimg.com/media/synd_photo_1.jpg',
          width: 1920,
          height: 1080,
        },
      ],
      video: {
        variants: [
          {
            bitrate: 256000,
            type: 'video/mp4',
            src: 'https://video.twimg.com/synd_low.mp4',
          },
          {
            bitrate: 2176000,
            type: 'video/mp4',
            src: 'https://video.twimg.com/synd_high.mp4',
          },
          {
            type: 'application/x-mpegURL',
            src: 'https://video.twimg.com/synd_playlist.m3u8',
          },
        ],
      },
    };

    const result = parseTwitterMedia(syndicationPayload);
    expect(result).toHaveLength(2);
    // Photo
    expect(result[0].id).toBe('1800000000000');
    expect(result[0].author).toBe('syndicated_dev');
    expect(result[0].type).toBe('image');
    expect(result[0].url).toBe('https://pbs.twimg.com/media/synd_photo_1?format=jpg&name=orig');
    // Video: selects highest bitrate MP4
    expect(result[1].id).toBe('1800000000000');
    expect(result[1].type).toBe('video');
    expect(result[1].bitrate).toBe(2176000);
    expect(result[1].url).toBe('https://video.twimg.com/synd_high.mp4');

    // Also verify mediaDetails variant from syndication
    const syndicationDetailsPayload = {
      id_str: '1800000000001',
      user: { screen_name: 'details_user' },
      mediaDetails: [
        {
          type: 'photo',
          media_url_https: 'https://pbs.twimg.com/media/detail_pic.png',
        },
      ],
    };
    const detailsResult = parseTwitterMedia(syndicationDetailsPayload);
    expect(detailsResult).toHaveLength(1);
    expect(detailsResult[0].id).toBe('1800000000001');
    expect(detailsResult[0].author).toBe('details_user');
    expect(detailsResult[0].url).toBe('https://pbs.twimg.com/media/detail_pic?format=png&name=orig');
  });
});

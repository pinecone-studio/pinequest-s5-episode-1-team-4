import { describe, expect, it } from 'vitest';

import { extractPlace, spokenDistance, toManeuvers, voiceCommand } from '../src/navigation';

describe('navigation', () => {
  it('extracts the place from what the user said', () => {
    expect(extractPlace('УИД рүү явмаар байна.')).toBe('Улсын их дэлгүүр');
    expect(extractPlace('Хараагүйчүүдийн үндэсний холбоо руу яв.')).toBe('Хараагүйчүүдийн үндэсний холбоо');
    expect(extractPlace('Сүхбаатарын талбай.')).toBe('Сүхбаатарын талбай');
    expect(extractPlace('улсын их дэлгүүр явъя')).toBe('улсын их дэлгүүр');
    expect(extractPlace('сүхбаатарын талбай явъя')).toBe('сүхбаатарын талбай');
    expect(extractPlace('би сүхбаатарын талбай очмоор байна')).toBe('сүхбаатарын талбай');
  });

  it('turns OSRM steps into Mongolian turn instructions, skipping straight segments', () => {
    const step = (type: string, modifier?: string) => ({ maneuver: { type, modifier, location: [106.9, 47.9] as [number, number] } });
    const maneuvers = toManeuvers([step('depart', 'straight'), step('turn', 'right'), step('new name', 'straight'), step('arrive', 'left')]);
    expect(maneuvers).toEqual([{ lat: 47.9, lon: 106.9, announce: '50 метрийн дараа баруун тийш эргэнэ.', now: 'Одоо баруун тийш эргэ.' }]);
  });

  it('recognises voice commands but treats "…рүү" as a destination', () => {
    expect(voiceCommand('энийг уншаад өг')).toBe('read');
    expect(voiceCommand('орчноо тайлбарла')).toBe('scene');
    expect(voiceCommand('алхах горим асаа')).toBe('walk_on');
    expect(voiceCommand('алхахаа зогсоо')).toBe('walk_off');
    expect(voiceCommand('улсын их дэлгүүр рүү алхъя')).toBeNull();
    expect(voiceCommand('сүхбаатарын талбай явъя')).toBeNull();
  });

  it('rounds spoken distances', () => {
    expect(spokenDistance(96)).toBe('100 метр');
    expect(spokenDistance(1421)).toBe('1.4 километр');
  });
});

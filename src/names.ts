// Project names: two plain words that are easy to say and remember, like "Amber Hollow".
// Both lists stay short and landscape-flavoured so every pairing reads as a place.
const FIRST = [
  'Amber', 'Ashen', 'Azure', 'Bright', 'Broken', 'Cedar', 'Cinder', 'Cobalt', 'Copper', 'Coral',
  'Crimson', 'Crystal', 'Distant', 'Drift', 'Dusty', 'Ember', 'Fallow', 'Frozen', 'Gentle', 'Ghost',
  'Golden', 'Granite', 'Hidden', 'Hollow', 'Indigo', 'Iron', 'Ivory', 'Jade', 'Lonely', 'Lunar',
  'Marble', 'Misty', 'Molten', 'Mossy', 'Opal', 'Pale', 'Quiet', 'Raven', 'Rusty', 'Salt',
  'Scarlet', 'Silent', 'Silver', 'Slate', 'Solar', 'Stony', 'Sunken', 'Tidal', 'Velvet', 'Violet',
  'Western', 'Windy', 'Winter', 'Wild',
];
const SECOND = [
  'Basin', 'Bay', 'Bluff', 'Canyon', 'Cape', 'Cove', 'Crater', 'Creek', 'Crest', 'Delta',
  'Dune', 'Falls', 'Fjord', 'Glacier', 'Glade', 'Gorge', 'Grove', 'Harbor', 'Haven', 'Heath',
  'Hollow', 'Island', 'Isle', 'Lagoon', 'Lake', 'Ledge', 'Marsh', 'Meadow', 'Mesa', 'Moor',
  'Oasis', 'Pass', 'Peak', 'Plateau', 'Point', 'Pond', 'Rapids', 'Reach', 'Reef', 'Ridge',
  'Shoal', 'Shore', 'Sound', 'Spire', 'Springs', 'Summit', 'Tarn', 'Terrace', 'Vale', 'Valley',
];

const pick = (list: string[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** A random two-word project name. */
export function projectName(rand: () => number = Math.random): string {
  const a = pick(FIRST, rand);
  let b = pick(SECOND, rand);
  while (b === a) b = pick(SECOND, rand);
  return `${a} ${b}`;
}

/** The name as a file name stem: "Amber Hollow" becomes "amber-hollow". */
export function fileStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'caldera';
}

/**
 * place-situation-anchors.ts — Scene-Specific WHERE/WHAT/MOTION/LIGHT Anchor Library
 *
 * 장면 유형 + 환경 키워드에 따라 구체적 장소/상황 증거를 선택.
 * generic fallback은 최후 수단.
 *
 * grep: getPlaceIdentityCandidates, getSituationEvidenceCandidates,
 *       getNaturalMotionCandidates, getLightSourceCandidates
 */

// ═══════════════════════════════════════════════════════════════════
// 1. Scene Context Detection
// ═══════════════════════════════════════════════════════════════════

export type SceneContext =
  | "square_plaza"      // 광장/게이트/시민공간
  | "battlefield"       // 전장/전쟁 피해 지역
  | "airport"           // 공항/활주로
  | "harbor_port"       // 항구/해안
  | "map_graphic"       // 지도/그래픽
  | "desert"            // 사막/건조 지대
  | "forest"            // 숲/정글
  | "mountain"          // 산악/고산
  | "urban"             // 도시/시가지
  | "snow_arctic"       // 설원/극지
  | "ocean_coast"       // 해양/해안
  | "field_plain"       // 평원/초원
  | "ruins"             // 폐허/고대 유적
  | "industrial"        // 공장/산업 시설
  | "generic";          // 범용 (최후 수단)

const CONTEXT_PATTERNS: Array<{ context: SceneContext; pattern: RegExp }> = [
  { context: "square_plaza", pattern: /\b(square|plaza|piazza|courtyard|gate|civic|tiananmen|red\s+square|tahrir|maidan|monument|memorial|boulevard|avenue|promenade)\b/i },
  { context: "battlefield", pattern: /\b(battle|war[\s-]?torn|war[\s-]?scarred|combat|conflict|devastat|bombed|shell|military|frontline|trench|fortification|siege|no[\s-]?man|demilitariz)\b/i },
  { context: "airport", pattern: /\b(airport|runway|tarmac|airfield|airstrip|hangar|terminal|control\s+tower|aircraft|airplane|jet|taxiway|apron)\b/i },
  { context: "harbor_port", pattern: /\b(harbor|harbour|port|dock|pier|wharf|quay|marina|shipyard|jetty|breakwater|lighthouse|berth)\b/i },
  { context: "map_graphic", pattern: /\b(map|cartograph|topograph|relief|contour|compass\s+rose|border\s+line|legend|parchment|globe|atlas|projection|grid\s+line)\b/i },
  { context: "desert", pattern: /\b(desert|arid|sand|dune|barren|sahara|gobi|mojave|oasis|cactus|scorching)\b/i },
  { context: "forest", pattern: /\b(forest|wood|jungle|canopy|tree|grove|thicket|undergrowth|rainforest|taiga|boreal)\b/i },
  { context: "mountain", pattern: /\b(mountain|alpine|peak|ridge|cliff|summit|valley|canyon|gorge|ravine|highland|plateau)\b/i },
  { context: "snow_arctic", pattern: /\b(snow|ice|frozen|arctic|tundra|glacier|polar|blizzard|frost|permafrost|iceberg)\b/i },
  { context: "ocean_coast", pattern: /\b(ocean|sea|coast|beach|shore|wave|surf|tide|reef|lagoon|bay|cove|seashore)\b/i },
  { context: "field_plain", pattern: /\b(field|plain|meadow|grassland|steppe|savanna|prairie|pasture|farmland|cropland)\b/i },
  { context: "ruins", pattern: /\b(ruin|ancient|temple|pyramid|colosseum|acropolis|archaeological|remnant|vestige|crumbl|decay|abandon)\b/i },
  { context: "industrial", pattern: /\b(factory|industrial|plant|refinery|warehouse|silo|chimney|smokestack|rail\s*yard|foundry|mill)\b/i },
  { context: "urban", pattern: /\b(city|urban|town|street|block|district|downtown|skyline|skyscraper|intersection|alley|neighborhood)\b/i },
];

/**
 * 환경 텍스트에서 scene context를 추론.
 *
 * grep: detectSceneContext
 */
export function detectSceneContext(environment: string, subjectPrimary: string, moodLighting: string): SceneContext {
  const fullText = `${environment} ${subjectPrimary} ${moodLighting}`;
  for (const { context, pattern } of CONTEXT_PATTERNS) {
    if (pattern.test(fullText)) return context;
  }
  return "generic";
}

// ═══════════════════════════════════════════════════════════════════
// 2. WHERE — Scene-Specific Place Identity Candidates
// ═══════════════════════════════════════════════════════════════════

const PLACE_CANDIDATES: Record<SceneContext, string[]> = {
  square_plaza: [
    "monumental stone gate with heavy iron fixtures",
    "wide paved civic square with geometric stone patterns",
    "row of tall flagpoles along the plaza edge",
    "large civic square bounded by symmetrical architecture",
    "weathered stone monument at the center of the square",
  ],
  battlefield: [
    "cratered muddy ground with exposed earth",
    "charred tank hull half-buried in debris",
    "broken concrete fortification with rebar exposed",
    "coils of rusted barbed wire across the terrain",
    "collapsed concrete bunker with blast marks",
  ],
  airport: [
    "faded runway markings on cracked tarmac",
    "parked aircraft silhouette on the apron",
    "metal boarding stairs standing on the tarmac",
    "hangar edge with corrugated metal siding",
    "control tower structure against the sky",
  ],
  harbor_port: [
    "weathered wooden pier extending over water",
    "rusted bollard at the dock edge",
    "concrete breakwater with wave-splashed surface",
    "lighthouse tower at the harbor mouth",
    "mooring chains draped over dock cleats",
  ],
  map_graphic: [
    "ornate compass rose in the corner",
    "detailed relief contour lines on parchment",
    "decorative border frame with scale bar",
    "grid lines overlaying terrain elevation",
    "cartographic legend panel with symbols",
  ],
  desert: [
    "lone sandstone rock formation on the horizon",
    "wind-sculpted dune ridge stretching across the frame",
    "dried riverbed cutting through cracked earth",
    "weathered desert mesa in the distance",
    "sun-bleached animal skull on parched ground",
  ],
  forest: [
    "massive fallen tree trunk across the path",
    "gnarled root system exposed at a riverbank",
    "moss-covered boulder beneath the canopy",
    "ancient tree with thick twisted trunk",
    "forest clearing ringed by tall trees",
  ],
  mountain: [
    "jagged rock outcrop at the ridge line",
    "narrow mountain pass between cliff walls",
    "cairn of stacked stones at the summit",
    "glacial moraine with scattered boulders",
    "steep switchback trail carved into rock face",
  ],
  snow_arctic: [
    "frozen signpost half-buried in snow",
    "ice shelf edge with fractured blue surface",
    "snow-drifted cabin with buried doorway",
    "frozen lake surface with pressure ridges",
    "icicle-covered rock overhang",
  ],
  ocean_coast: [
    "weathered wooden dock jutting into water",
    "sea stack rising from the surf",
    "tidal rock pool at the shoreline",
    "eroded cliff face overlooking the sea",
    "beached fishing boat on wet sand",
  ],
  field_plain: [
    "lone fence post leaning at an angle",
    "hay bale sitting in a stubble field",
    "distant windmill silhouette on the horizon",
    "irrigation channel cutting through flat ground",
    "solitary tree standing in open grassland",
  ],
  ruins: [
    "crumbling stone archway with vine overgrowth",
    "half-standing column base on a mosaic floor",
    "collapsed wall revealing interior rubble",
    "ornate carved lintel over a doorless frame",
    "stone foundation outline in overgrown grass",
  ],
  industrial: [
    "rusted steel smokestack rising from the roof",
    "conveyor belt structure stretching between buildings",
    "concrete cooling tower silhouette",
    "rail yard tracks converging toward the plant",
    "corroded storage tank with peeling paint",
  ],
  urban: [
    "weathered stone building facade with dark windows",
    "fire escape zigzagging down a brick wall",
    "cracked concrete sidewalk with a storm drain",
    "traffic signal hanging over an empty intersection",
    "metal-shuttered storefront at street level",
  ],
  generic: [
    "weathered stone structure in the mid-ground",
    "weathered concrete slab partially overgrown",
    "rusted metal post at the edge of the frame",
  ],
};

/**
 * Scene context에 맞는 장소 정체성 후보 반환.
 *
 * grep: getPlaceIdentityCandidates
 */
export function getPlaceIdentityCandidates(sceneContext: SceneContext): string[] {
  return PLACE_CANDIDATES[sceneContext] || PLACE_CANDIDATES.generic;
}

// ═══════════════════════════════════════════════════════════════════
// 3. WHAT — Scene-Specific Situation Evidence Candidates
// ═══════════════════════════════════════════════════════════════════

const EVIDENCE_CANDIDATES: Record<SceneContext, string[]> = {
  square_plaza: [
    "dense crowd formation filling the plaza",
    "flags moving rhythmically in the wind",
    "long shadows crossing stone ground from tall structures",
    "banners stretched between poles overhead",
    "pigeons scattering across wet paving stones",
  ],
  battlefield: [
    "drifting smoke plumes from impact points",
    "scorched metal fragments scattered on the ground",
    "torn earth with exposed soil and roots",
    "ash particles floating in the hazy air",
    "muddy tire tracks gouged across the terrain",
  ],
  airport: [
    "heat haze shimmering above the tarmac",
    "dust from prop wash sweeping across the ground",
    "ground crew vehicle moving across the apron",
    "windsock stretched taut in the crosswind",
    "jet exhaust distorting the air behind an aircraft",
  ],
  harbor_port: [
    "waves lapping against dock pilings",
    "seagulls circling above the harbor",
    "salt spray carried by the offshore wind",
    "mooring ropes creaking under tension",
    "oil sheen on the harbor surface",
  ],
  map_graphic: [
    "spreading highlight revealing new territory",
    "pulsing heatmap gradient across the surface",
    "fading sepia tone at the parchment edge",
    "animated route line extending across the map",
    "color-shift wash moving over terrain features",
  ],
  desert: [
    "fine sand particles carried by wind across ground",
    "heat shimmer distorting the distant horizon",
    "dust devil spinning across the flat terrain",
    "long ripple shadows on the dune face",
    "dry brush tumbling slowly across cracked earth",
  ],
  forest: [
    "shafts of light filtering through branches, leaves drifting down",
    "morning mist hanging between tree trunks",
    "insects rising in a column of sunlight",
    "water droplets falling from wet leaves",
    "ferns swaying in a gentle ground-level breeze",
  ],
  mountain: [
    "loose gravel shifting on the slope, wind-carried dust",
    "cloud shadow moving across the valley floor",
    "waterfall mist drifting across the rock face",
    "snow crystals blowing off the ridge crest",
    "raptor silhouette circling in a thermal updraft",
  ],
  snow_arctic: [
    "wind-driven snow particles sweeping across surface",
    "ice crystals catching the light as they drift",
    "breath-like vapor rising from the ground surface",
    "cracking sound visualized as ice stress patterns",
    "soft powder disturbed by wind, creating low ground drift",
  ],
  ocean_coast: [
    "foam-streaked waves washing across the shore",
    "spray from breaking waves catching the light",
    "receding tide leaving wet sand patterns",
    "seaweed undulating in shallow current",
    "sand grains lifted by shore wind",
  ],
  field_plain: [
    "tall grass rippling in waves under the wind",
    "pollen or seed heads drifting through sunlight",
    "ground-level heat shimmer in warm air",
    "bird flock shifting formation over the field",
    "morning dew catching light on grass blades",
  ],
  ruins: [
    "dust motes swirling in light through a broken roof",
    "small stones falling from a crumbling wall edge",
    "vine tendrils slowly stirring in the breeze",
    "water dripping from a damaged ceiling",
    "lichen patterns spreading across weathered stone",
  ],
  industrial: [
    "steam venting from a cracked pipe",
    "rust-colored water pooling on concrete",
    "conveyor belt debris scattered on the floor",
    "pigeons nesting in broken window frames",
    "peeling paint flakes lifted by a draft",
  ],
  urban: [
    "loose paper and dust drifting across empty pavement",
    "steam rising from a manhole cover",
    "puddle rippling from a distant vibration",
    "neon sign flickering in a dark storefront",
    "traffic light cycling to no one",
  ],
  generic: [
    "subtle dust particles drifting through ambient light",
    "faint breeze stirring loose elements on the ground",
    "gentle light shift as clouds move overhead",
  ],
};

/**
 * Scene context에 맞는 상황 증거 후보 반환.
 *
 * grep: getSituationEvidenceCandidates
 */
export function getSituationEvidenceCandidates(sceneContext: SceneContext): string[] {
  return EVIDENCE_CANDIDATES[sceneContext] || EVIDENCE_CANDIDATES.generic;
}

// ═══════════════════════════════════════════════════════════════════
// 4. MOTION — Natural Environmental Motion Candidates
// ═══════════════════════════════════════════════════════════════════

const MOTION_CANDIDATES: Record<SceneContext, string[]> = {
  square_plaza: [
    "flags gently swaying on their poles",
    "crowd slowly shifting as a collective mass",
    "birds lifting off the square in a scattered flock",
  ],
  battlefield: [
    "smoke drifting slowly across the terrain",
    "embers floating upward from smoldering wreckage",
    "haze thickening and thinning with the breeze",
  ],
  airport: [
    "windsock rotating in shifting crosswind",
    "heat haze rippling above the runway",
    "ground vehicle crawling along the taxiway",
  ],
  harbor_port: [
    "boats rocking gently at their moorings",
    "waves rolling in slow rhythm against the seawall",
    "rigging cables swaying in the harbor breeze",
  ],
  map_graphic: [
    "slow camera push revealing additional map detail",
    "terrain shading subtly shifting with virtual light angle",
    "contour lines gently pulsing to indicate elevation change",
  ],
  desert: [
    "sand grains streaming along the dune surface",
    "distant heat shimmer making horizon line waver",
    "tumbleweed rolling slowly across cracked ground",
  ],
  forest: [
    "canopy leaves rustling in a gentle breeze",
    "dappled sunlight slowly shifting across the forest floor",
    "mist tendrils drifting between the tree trunks",
  ],
  mountain: [
    "clouds slowly wrapping around the peak",
    "waterfall mist gently drifting sideways",
    "shadow of a cloud moving across the valley",
  ],
  snow_arctic: [
    "snow particles drifting horizontally in steady wind",
    "ice crystals sparkling as the light angle shifts",
    "low ground blizzard streaming across the surface",
  ],
  ocean_coast: [
    "waves rhythmically breaking and receding on shore",
    "sea grass undulating in the underwater current",
    "seabirds gliding in slow circles over the water",
  ],
  field_plain: [
    "grass rippling in long continuous waves under wind",
    "seed heads releasing and floating upward in thermals",
    "grazing animals slowly shifting across the field",
  ],
  ruins: [
    "dust motes rotating slowly in a shaft of light",
    "water slowly dripping into a still pool below",
    "vine tendrils swaying almost imperceptibly",
  ],
  industrial: [
    "steam column rising steadily from a vent",
    "rusty chain swinging slowly in a draft",
    "dripping water creating ripples in a ground puddle",
  ],
  urban: [
    "steam rising steadily from a manhole grate",
    "traffic light cycling through colors on empty street",
    "newspaper page tumbling slowly down the sidewalk",
  ],
  generic: [
    "subtle air movement carrying fine particles through the frame",
    "gentle light shift as atmospheric conditions change",
    "faint ground-level haze drifting across the scene",
  ],
};

/**
 * Scene context에 맞는 자연 환경 모션 후보 반환.
 *
 * grep: getNaturalMotionCandidates
 */
export function getNaturalMotionCandidates(sceneContext: SceneContext): string[] {
  return MOTION_CANDIDATES[sceneContext] || MOTION_CANDIDATES.generic;
}

// ═══════════════════════════════════════════════════════════════════
// 5. LIGHT — Explicit Light Source Candidates
// ═══════════════════════════════════════════════════════════════════

/** Time-of-day detection patterns */
const TIME_PATTERNS: Array<{ time: string; pattern: RegExp }> = [
  { time: "dawn", pattern: /\b(dawn|sunrise|first\s+light|early\s+morning|pre[\s-]?dawn|daybreak)\b/i },
  { time: "golden_hour", pattern: /\b(golden\s+hour|late\s+afternoon|warm\s+sun|sunset\s+glow|magic\s+hour)\b/i },
  { time: "midday", pattern: /\b(midday|noon|overhead\s+sun|harsh\s+sun|bright\s+daylight|high\s+sun|zenith)\b/i },
  { time: "overcast", pattern: /\b(overcast|cloudy|grey\s+sky|gray\s+sky|diffused|flat\s+light|heavy\s+cloud)\b/i },
  { time: "dusk", pattern: /\b(dusk|twilight|blue\s+hour|evening|fading\s+light|last\s+light)\b/i },
  { time: "night", pattern: /\b(night|moonlight|starlight|darkness|nocturnal|midnight|lamp[\s-]?lit)\b/i },
  { time: "fire_glow", pattern: /\b(fire|flame|blaze|burning|ember|inferno|torch|fiery|campfire)\b/i },
  { time: "fog_mist", pattern: /\b(fog|mist|haze|murky|veiled|obscured|foggy|misty)\b/i },
];

const LIGHT_SOURCES: Record<string, string[]> = {
  dawn: [
    "pale pink-orange sunrise at the horizon, casting long horizontal shadows",
    "first light breaking over the eastern horizon, warm amber tone at low angle",
  ],
  golden_hour: [
    "late afternoon sun from upper left, casting warm golden light with long defined shadows",
    "low-angle sunset light from the right, creating deep amber tones and stretched silhouettes",
  ],
  midday: [
    "direct midday sun from overhead, creating short harsh shadows and bright highlights",
    "high-angle strong sunlight from above, bleaching exposed surfaces with minimal shadow",
  ],
  overcast: [
    "diffused light through thick cloud layer, creating even illumination with soft shadows",
    "flat grey skylight from above, no direct sun, muted tones with gentle ambient shadows",
  ],
  dusk: [
    "fading blue-purple twilight from the western sky, deep shadows from the east",
    "last orange light at the horizon bleeding into deep blue overhead",
  ],
  night: [
    "cold blue moonlight from above-right, with deep black shadows and silver highlights",
    "scattered artificial light from distant sources, creating orange-blue contrast pools",
  ],
  fire_glow: [
    "warm orange-red firelight flickering from below-left, casting dancing shadows upward",
    "scattered fire glow from multiple ground-level sources, creating warm pools in darkness",
  ],
  fog_mist: [
    "diffused ambient light scattered through fog, creating a soft luminous glow with no visible source",
    "muted directional light penetrating haze from above, creating soft volumetric rays",
  ],
};

export interface LightSourceResult {
  hasExplicitSource: boolean;
  detectedTime: string | null;
  suggestedSource?: string;
}

/**
 * moodLighting에 명시적 광원(source+direction+quality)이 있는지 검사.
 * direction만 있고 source가 없으면 보정 후보 반환.
 *
 * grep: getLightSourceCandidates
 */
export function getLightSourceCandidates(moodLighting: string, environment: string): LightSourceResult {
  const fullText = `${moodLighting} ${environment}`;

  // 이미 명시적 source가 있는지 확인
  const hasExplicitSource = /\b(sun(?:light)?|moon(?:light)?|fire(?:light)?|lamp|torch|neon|streetlight|spotlight|candle|headlight|fluorescent)\b/i.test(fullText)
    && /\b(from|cast|angle|overhead|left|right|behind|above|below|horizon|east|west)\b/i.test(fullText);

  if (hasExplicitSource) {
    return { hasExplicitSource: true, detectedTime: null };
  }

  // time-of-day 추론
  for (const { time, pattern } of TIME_PATTERNS) {
    if (pattern.test(fullText)) {
      const candidates = LIGHT_SOURCES[time] || LIGHT_SOURCES.overcast;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { hasExplicitSource: false, detectedTime: time, suggestedSource: pick };
    }
  }

  // 기본값
  return {
    hasExplicitSource: false,
    detectedTime: null,
    suggestedSource: "diffused natural light from above, creating even illumination with soft ambient shadows",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Natural Motion Detection
// ═══════════════════════════════════════════════════════════════════

/** 자연 환경 모션이 이미 있는지 감지 */
const MOTION_PRESENCE_PATTERNS = [
  /\b(wind|breeze|gust|draft)\s+\w+/i,
  /\b(drift|float|sway|ripple|flutter|rustle|billow|stream|roll)\w*\b/i,
  /\b(wave|tide|current|flow|pour|cascade)\w*\s/i,
  /\b(smoke|mist|fog|haze|dust|ash|ember|particle|snow|rain)\s+\w*(drift|float|rise|fall|hang|cling|swirl|sweep|settle)\w*\b/i,
  /\b(shimmer|flicker|pulse|glow|shift|change|cycle|fade)\w*\b/i,
];

export interface NaturalMotionResult {
  hasMotion: boolean;
  matchedMotions: string[];
  suggestedMotion?: string;
}

/**
 * 문서에 자연 환경 모션이 있는지 검사.
 *
 * grep: detectNaturalMotion
 */
export function detectNaturalMotion(
  subjectAction: string,
  environment: string,
  moodLighting: string,
): NaturalMotionResult {
  const fullText = `${subjectAction} ${environment} ${moodLighting}`;
  const matchedMotions: string[] = [];

  for (const pattern of MOTION_PRESENCE_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) matchedMotions.push(match[0]);
  }

  return { hasMotion: matchedMotions.length > 0, matchedMotions };
}

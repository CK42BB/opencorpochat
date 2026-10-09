// SPDX-License-Identifier: AGPL-3.0-only
// Generates the AI artwork used by the demo seed and marketing images (OpenAI Images API).
// Usage: OPENAI_API_KEY=... node scripts/marketing/generate-art.mjs [name ...]
// Outputs are committed, so this only needs re-running to refresh the art.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error('Set OPENAI_API_KEY');
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';

const NO_TEXT =
  'Absolutely no text, letters, numbers, logos, watermarks or brand marks anywhere in the image.';
const ART = [
  {
    name: 'apps/server/assets/demo/aurora-homepage-v2.png',
    size: '1536x1024',
    prompt: `A polished landing-page hero design mockup for a fictional sustainable-energy startup, shown flat as a web design comp (not a photo of a screen). Soft aurora gradient of teal, violet and warm peach, a large rounded hero illustration of abstract glowing hills, clean grid layout with placeholder blocks where text would go (rounded grey bars instead of words), one pill-shaped button shape. Modern, airy, premium Dribbble-quality UI design. ${NO_TEXT}`,
  },
  ...[
    [
      'cam-maya',
      'a friendly East Asian woman in her early 30s with shoulder-length black hair and round glasses, wearing a cream knit sweater, smiling warmly, sitting in a bright home studio with plants and a pegboard of design tools behind her',
    ],
    [
      'cam-sam',
      'a Black man in his late 30s with a short beard, wearing a navy henley, laughing naturally, in a cozy home office with a bookshelf and warm lamp light behind him',
    ],
    [
      'cam-leo',
      'a young Latino man in his late 20s with curly hair, wearing over-ear headphones around his neck and a grey t-shirt, smiling, in a modern apartment with a window and city view behind him',
    ],
    [
      'cam-priya',
      'a South Asian woman in her 30s with long dark hair tied back, wearing a mustard blouse, nodding and smiling, in a light minimalist office with a whiteboard behind her',
    ],
  ].map(([n, who]) => ({
    name: `apps/server/assets/demo/${n}.png`,
    size: '1536x1024',
    prompt: `Realistic webcam video-call frame of ${who}. Eye-level framing from chest up, natural daylight, shallow depth of field, authentic and candid, high quality. Entirely fictional person. ${NO_TEXT}`,
  })),
  {
    name: 'docs/images/marketing/art/bg-hero.png',
    size: '1536x1024',
    prompt: `Abstract premium background for a software product launch: smooth flowing ribbons of light in deep indigo (#1f1b3a), electric violet (#4a3aff) and soft lavender, with subtle glassy depth and a gentle grain, dark overall with luminous highlights toward the right side, lots of calm negative space on the left. ${NO_TEXT}`,
  },
  {
    name: 'docs/images/marketing/art/bg-light.png',
    size: '1536x1024',
    prompt: `Abstract light background: soft pastel mesh gradient of lavender, periwinkle, pale pink and white with very subtle glassy curved shapes and fine grain, airy and optimistic, mostly bright with gentle color in the corners. ${NO_TEXT}`,
  },
  {
    name: 'docs/images/marketing/art/bg-calls.png',
    size: '1536x1024',
    prompt: `Abstract background evoking voice and video: concentric soft sound-wave rings and gentle glowing orbs in deep navy, violet and teal, calm and premium, dark with soft light bloom. ${NO_TEXT}`,
  },
  {
    name: 'docs/images/marketing/art/bg-security.png',
    size: '1536x1024',
    prompt: `Abstract background evoking trust and security: layered translucent geometric shield-like facets and fine circuit-like light lines in deep indigo and emerald teal, premium, dark, elegant, with soft glow. ${NO_TEXT}`,
  },
  {
    name: 'docs/images/marketing/art/bg-integrations.png',
    size: '1536x1024',
    prompt: `Abstract background evoking connected integrations: softly glowing nodes linked by curved light paths, like a constellation, in deep indigo with violet, magenta and cyan accents, premium and calm. ${NO_TEXT}`,
  },
];

const only = process.argv.slice(2);
const jobs = ART.filter((a) =>
  only.length ? only.some((o) => a.name.includes(o)) : !existsSync(a.name),
);
await Promise.all(
  jobs.map(async (a) => {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: a.prompt, size: a.size, quality: 'high', n: 1 }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`✗ ${a.name}: ${data.error?.message ?? res.status}`);
      return;
    }
    mkdirSync(path.dirname(a.name), { recursive: true });
    writeFileSync(a.name, Buffer.from(data.data[0].b64_json, 'base64'));
    console.log(`✓ ${a.name}`);
  }),
);

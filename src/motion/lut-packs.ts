// Ready-made colour LUTs a video can use in place of its look's own colour
// (the plan's `lut`). Made by render-worker/import-luts.mjs from the LUT
// packs; the export applies the real LUT (render-worker/luts/<id>.lut), the
// editor preview a rough version of it (per-channel curves, then saturation).
// Don't edit by hand: run the import again.

export type PackLut = {
  id: string;
  name: string;
  pack: string;
  /** Black and white. */
  mono: boolean;
  /** The preview's version: curves at 9 even points (0-1), then saturation. */
  preview: { curves: { r: number[]; g: number[]; b: number[] }; saturation: number };
};

export const PACK_LUTS: PackLut[] = [
  {
    id: "hue-haven-autumn-dull",
    name: "Autumn Dull",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.128, 0.253, 0.372, 0.494, 0.618, 0.742, 0.865, 0.989],
        g: [0, 0.125, 0.25, 0.376, 0.502, 0.628, 0.753, 0.879, 1],
        b: [0, 0.116, 0.239, 0.37, 0.496, 0.62, 0.744, 0.867, 0.991],
      },
      saturation: 1.03,
    },
  },
  {
    id: "hue-haven-autumn-rich",
    name: "Autumn Rich",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.125, 0.25, 0.375, 0.5, 0.618, 0.732, 0.846, 0.968],
        g: [0, 0.125, 0.25, 0.375, 0.5, 0.626, 0.753, 0.881, 1],
        b: [0, 0.125, 0.25, 0.375, 0.5, 0.642, 0.795, 0.948, 1],
      },
      saturation: 0.96,
    },
  },
  {
    id: "hue-haven-bright",
    name: "Bright",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0.064, 0.185, 0.346, 0.514, 0.67, 0.807, 0.919, 1, 1],
        g: [0, 0.073, 0.223, 0.417, 0.6, 0.768, 0.902, 1, 1],
        b: [0, 0.045, 0.188, 0.383, 0.571, 0.746, 0.886, 1, 1],
      },
      saturation: 1.01,
    },
  },
  {
    id: "hue-haven-b-w-faded",
    name: "B&W Faded",
    pack: "Hue Haven",
    mono: true,
    preview: {
      curves: {
        r: [0.163, 0.237, 0.308, 0.378, 0.454, 0.539, 0.645, 0.802, 0.988],
        g: [0.163, 0.237, 0.308, 0.378, 0.454, 0.539, 0.645, 0.802, 0.988],
        b: [0.163, 0.237, 0.308, 0.378, 0.454, 0.539, 0.645, 0.802, 0.988],
      },
      saturation: 0.01,
    },
  },
  {
    id: "hue-haven-b-w-high-contrast",
    name: "B&W High Contrast",
    pack: "Hue Haven",
    mono: true,
    preview: {
      curves: {
        r: [0, 0.079, 0.161, 0.281, 0.449, 0.637, 0.81, 0.93, 1],
        g: [0, 0.079, 0.161, 0.281, 0.449, 0.637, 0.81, 0.93, 1],
        b: [0, 0.079, 0.161, 0.281, 0.449, 0.637, 0.81, 0.93, 1],
      },
      saturation: 0.01,
    },
  },
  {
    id: "hue-haven-classy",
    name: "Classy",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.034, 0.122, 0.299, 0.547, 0.782, 0.938, 0.988, 0.999],
        g: [0, 0.035, 0.128, 0.319, 0.573, 0.811, 0.951, 0.989, 0.999],
        b: [0, 0.038, 0.138, 0.348, 0.61, 0.847, 0.965, 0.99, 0.999],
      },
      saturation: 1.17,
    },
  },
  {
    id: "hue-haven-deep",
    name: "Deep",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.058, 0.138, 0.221, 0.319, 0.449, 0.612, 0.799, 0.987],
        g: [0, 0.058, 0.138, 0.221, 0.319, 0.449, 0.612, 0.799, 0.987],
        b: [0, 0.058, 0.138, 0.221, 0.318, 0.449, 0.612, 0.799, 0.987],
      },
      saturation: 1.14,
    },
  },
  {
    id: "hue-haven-dream",
    name: "Dream",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.139, 0.289, 0.438, 0.589, 0.741, 0.893, 1, 1],
        g: [0, 0.13, 0.26, 0.39, 0.519, 0.647, 0.774, 0.902, 1],
        b: [0.024, 0.209, 0.398, 0.591, 0.788, 0.989, 1, 1, 1],
      },
      saturation: 1.11,
    },
  },
  {
    id: "hue-haven-orange-teal-faded",
    name: "Orange Teal Faded",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0.131, 0.206, 0.292, 0.388, 0.494, 0.608, 0.731, 0.862, 1],
        g: [0.131, 0.206, 0.292, 0.388, 0.494, 0.608, 0.731, 0.862, 1],
        b: [0.131, 0.206, 0.292, 0.388, 0.494, 0.608, 0.731, 0.862, 1],
      },
      saturation: 0.97,
    },
  },
  {
    id: "hue-haven-orange-teal",
    name: "Orange Teal",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.06, 0.159, 0.273, 0.405, 0.55, 0.706, 0.874, 1],
        g: [0, 0.06, 0.159, 0.273, 0.405, 0.55, 0.706, 0.874, 1],
        b: [0, 0.06, 0.159, 0.273, 0.405, 0.55, 0.706, 0.874, 1],
      },
      saturation: 0.95,
    },
  },
  {
    id: "hue-haven-prime",
    name: "Prime",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0.182, 0.196, 0.26, 0.378, 0.544, 0.728, 0.88, 1, 1],
        g: [0.175, 0.183, 0.221, 0.33, 0.505, 0.715, 0.889, 1, 1],
        b: [0.177, 0.186, 0.234, 0.351, 0.532, 0.737, 0.904, 1, 1],
      },
      saturation: 0.94,
    },
  },
  {
    id: "hue-haven-stark",
    name: "Stark",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.061, 0.207, 0.364, 0.523, 0.68, 0.828, 0.962, 1],
        g: [0, 0.061, 0.207, 0.364, 0.523, 0.68, 0.828, 0.962, 1],
        b: [0, 0.061, 0.207, 0.364, 0.523, 0.68, 0.828, 0.962, 1],
      },
      saturation: 1.01,
    },
  },
  {
    id: "hue-haven-vintage",
    name: "Vintage",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0.263, 0.307, 0.378, 0.486, 0.603, 0.725, 0.849, 0.972, 1],
        g: [0.208, 0.255, 0.331, 0.448, 0.573, 0.704, 0.838, 0.97, 1],
        b: [0.169, 0.215, 0.289, 0.403, 0.525, 0.653, 0.783, 0.912, 1],
      },
      saturation: 1.09,
    },
  },
  {
    id: "hue-haven-wash",
    name: "Wash",
    pack: "Hue Haven",
    mono: false,
    preview: {
      curves: {
        r: [0.237, 0.286, 0.335, 0.384, 0.435, 0.49, 0.551, 0.615, 0.68],
        g: [0.251, 0.301, 0.349, 0.399, 0.451, 0.508, 0.57, 0.634, 0.698],
        b: [0.238, 0.287, 0.336, 0.385, 0.437, 0.492, 0.553, 0.617, 0.681],
      },
      saturation: 1.19,
    },
  },
  {
    id: "prism-tones-better-sepia",
    name: "Better Sepia",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.162, 0.385, 0.559, 0.687, 0.807, 0.897, 0.956, 1],
        g: [0, 0.043, 0.182, 0.364, 0.567, 0.736, 0.852, 0.924, 0.976],
        b: [0, 0.01, 0.11, 0.252, 0.428, 0.598, 0.718, 0.796, 0.851],
      },
      saturation: 0.07,
    },
  },
  {
    id: "prism-tones-color-punch-cool",
    name: "Color Punch Cool",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.022, 0.038, 0.116, 0.28, 0.51, 0.739, 0.902, 0.986, 0.994],
        g: [0.022, 0.045, 0.116, 0.278, 0.518, 0.737, 0.902, 0.982, 0.994],
        b: [0.319, 0.397, 0.479, 0.567, 0.66, 0.753, 0.842, 0.915, 0.916],
      },
      saturation: 0.9,
    },
  },
  {
    id: "prism-tones-color-punch-warm",
    name: "Color Punch Warm",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0, 0, 0.075, 0.251, 0.499, 0.748, 0.922, 1, 1],
        g: [0, 0.009, 0.075, 0.248, 0.51, 0.745, 0.921, 0.995, 1],
        b: [0.094, 0.206, 0.31, 0.405, 0.493, 0.583, 0.678, 0.785, 0.894],
      },
      saturation: 1.03,
    },
  },
  {
    id: "prism-tones-earthy",
    name: "Earthy",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.007, 0.168, 0.327, 0.474, 0.606, 0.722, 0.825, 0.914, 0.994],
        g: [0.059, 0.098, 0.208, 0.36, 0.496, 0.628, 0.757, 0.878, 0.994],
        b: [0.007, 0.048, 0.133, 0.274, 0.439, 0.597, 0.748, 0.857, 0.951],
      },
      saturation: 0.79,
    },
  },
  {
    id: "prism-tones-edgy",
    name: "Edgy",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.126, 0.126, 0.134, 0.24, 0.514, 0.73, 0.814, 0.849, 0.874],
        g: [0.126, 0.126, 0.134, 0.24, 0.514, 0.73, 0.814, 0.849, 0.874],
        b: [0.126, 0.126, 0.134, 0.24, 0.514, 0.73, 0.814, 0.849, 0.874],
      },
      saturation: 0.49,
    },
  },
  {
    id: "prism-tones-golden",
    name: "Golden",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.177, 0.28, 0.503, 0.692, 0.806, 0.868, 0.918, 0.973, 0.989],
        g: [0.063, 0.114, 0.297, 0.563, 0.761, 0.856, 0.899, 0.966, 0.989],
        b: [0.066, 0.099, 0.202, 0.395, 0.612, 0.771, 0.829, 0.864, 0.9],
      },
      saturation: 1,
    },
  },
  {
    id: "prism-tones-hipstagram",
    name: "Hipstagram",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.057, 0.062, 0.199, 0.368, 0.61, 0.831, 0.934, 0.977, 0.985],
        g: [0.009, 0.025, 0.107, 0.373, 0.641, 0.801, 0.888, 0.943, 0.98],
        b: [0.051, 0.072, 0.155, 0.336, 0.521, 0.69, 0.781, 0.863, 0.927],
      },
      saturation: 0.73,
    },
  },
  {
    id: "prism-tones-hipstawash",
    name: "Hipstawash",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.18, 0.259, 0.349, 0.454, 0.565, 0.67, 0.759, 0.828, 0.886],
        g: [0.18, 0.259, 0.349, 0.455, 0.567, 0.672, 0.76, 0.828, 0.886],
        b: [0.18, 0.259, 0.349, 0.455, 0.567, 0.672, 0.76, 0.828, 0.886],
      },
      saturation: 0.82,
    },
  },
  {
    id: "prism-tones-keep-red",
    name: "Keep Red",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0, 0.071, 0.164, 0.3, 0.486, 0.678, 0.827, 0.926, 1],
        g: [0, 0.071, 0.163, 0.297, 0.48, 0.672, 0.823, 0.924, 1],
        b: [0, 0.071, 0.163, 0.297, 0.48, 0.672, 0.823, 0.924, 1],
      },
      saturation: 0.14,
    },
  },
  {
    id: "prism-tones-red-pink",
    name: "Red Pink",
    pack: "Prism Tones",
    mono: false,
    preview: {
      curves: {
        r: [0.34, 0.353, 0.413, 0.524, 0.635, 0.718, 0.763, 0.779, 0.782],
        g: [0.285, 0.276, 0.3, 0.387, 0.506, 0.622, 0.721, 0.782, 0.805],
        b: [0.296, 0.296, 0.329, 0.447, 0.573, 0.685, 0.75, 0.755, 0.753],
      },
      saturation: 1,
    },
  },
];

export const PACK_LUT_IDS = PACK_LUTS.map((l) => l.id);

/** A pack LUT by id, or null. */
export function packLut(id: string | null | undefined): PackLut | null {
  return PACK_LUTS.find((l) => l.id === id) ?? null;
}

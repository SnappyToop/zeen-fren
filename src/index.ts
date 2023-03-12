import fs from 'fs/promises';
import { program } from 'commander';
import magick from "./magick";

type Filename = string;

type Dimensions = {
  height: number,
  width: number,
  unit?: 'inches' | 'in' | 'cm',
};

type Pane = 'right' | 'left';

type Config = {
  images: Filename[],
  realDimensions: Dimensions,
  paperSize: {
    dimensions: Dimensions,
    margin?: number
  },
  format?: 'spread' | 'page',
  backIsFirst?: boolean,
};

type Layout = {
  paperSize: Dimensions,
  gridLayout: {
    x: number,
    y: number,
  },
  padding: number,
};

program
  .name('zf')
  .version('0.0.1')
  .option('-c, --config [config]', 'path to config file')
  .option('-f, --foo <foo>', 'foobar')
  .parse(process.argv);

// console.log(p.opts());

const opts = program.opts();

//TODO: set up temp directory correctly
const tempDir = 'tmp';

// 1. if config is passed, parse it and
// 1a. otherwise create a config from cmd line args
getConfig(opts).then(async config => {
  console.log(config);

  // 2. figure out image dimensions in pixels
  const dimensions = await getDimensions(config.images);
  // 3. process input images
  const pages = await processInputImages(config, dimensions, tempDir);
  console.log(pages);

  // 4. create new "spreads"
  const spreads = await createSpreadsFromPages(pages, tempDir)
  console.log(spreads);

  // 5. calculate most efficient layout
  const layout = await calculateLayout(config);
  console.log(layout);

  // 6. render spreads onto canvas
  const bigPages = await renderSpreads(layout, spreads);
  // console.log(bigPages);

// 7. compile to pdf/tiff


});


async function getConfig(opts) {
  if (opts.config) {
    const file = await fs.readFile(opts.config, 'utf-8');
    return JSON.parse(file);
  }
}

async function getDimensions(images: Filename[]) {
  // TODO: examine files and determine dimensions programatically
  // const height = 800;
  // const width = 800;
  const response = await magick({
    args: ['identify', '-format', '%wx%h', images[0] ],
    captureStdout: true
  });
  const [ height, width ] = response.split('x');
  // console.log(response);
  // const height = 3300;
  // const width = 2550; //5100x3300
  return { height, width };
}

async function processImage(
  imagePath: Filename,
  dimensions: Dimensions,
  pane: Pane,
  outFile: Filename,
) {
  const { height, width } = dimensions;
  const cropOffset = pane === 'left' ? 0 : width;
  const cropArgs = `${width}x${height}+${cropOffset}+0`;
  const args = [ imagePath, '-crop', cropArgs, outFile ];
  magick({ args });
}

async function processInputImages(
  config: Config,
  dimensions: Dimensions,
  tempDir: Filename
) {
  const images = config.backIsFirst ? [...config.images, config.images[0]] : config.images;
  const pages: Filename[] = [];
  // await images.forEach(async (image, idx) => {
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // NOTE: we skip the left pane on the first page (unless backIsFirst option is specified, 
    // in which case, it is processes as the final image)
    if (i !== 0) {
      const leftFileName = `${tempDir}/page-${i * 2 - 1}.png`;
      await processImage(image, dimensions, "left", leftFileName);
      // TODO: handle errors
      pages.push(leftFileName);
    }

    // NOTE: as with above, we skip right pane on the last page (again, unless backIsFirst
    // option is specified, in which case the last page will have already been handled above)
    if (i !== images.length - 1) {
      const rightFileName = `${tempDir}/page-${i * 2}.png`;
      await processImage(image, dimensions, "right", rightFileName);
      // TODO: handle errors
      pages.push(rightFileName);
    }
  }
  return pages;
}

async function createSpread(
  left: Filename,
  right: Filename,
  outFile: Filename
) {
  const cmd = 'magick';
  const args = [
    'montage',
    '-mode', 'concatenate',
    '-tile', 'x1',
    left, right,
    outFile
  ];
  return magick({ args });
}

async function createSpreadsFromPages(
  pages: Filename[],
  tempDir: Filename,
) {
  const spreads: string[] = [];
  for (let i = 0; i < pages.length / 2; i++) {
    let left, right;
    if (i % 2 === 0) {
      left = pages[pages.length - 1 - i];
      right = pages[i];
    } else {
      left = pages[i];
      right = pages[pages.length - 1 - i];
    }

    const outFile = `${tempDir}/spread-${i}.png`;
    if (await createSpread(left, right, outFile)) {
      spreads.push(outFile);
    }
  }
  return spreads;
}

function _calculateLayout(
  horizontalSpace: number, 
  verticalSpace: number,
  spreadWidth: number,
  spreadHeight: number
) {
  console.log({
    horizontalSpace,
    verticalSpace,
    spreadWidth,
    spreadHeight,
  })
  const x = Math.trunc(horizontalSpace / spreadWidth);
  const y = Math.trunc(verticalSpace / spreadHeight);
  return { x, y };
}

function calculateLayout(config: Config) {
  const marginX = 2 * (config.paperSize?.margin || 0);
  const marginY = 2 * (config.paperSize?.margin || 0);
  
  const horizontalSpace = (config.paperSize?.dimensions?.width || 8.5) - marginX;
  const verticalSpace = (config.paperSize?.dimensions?.height || 8.5) - marginY;

  const spreadWidth = 2 * (config.realDimensions.width);
  const spreadHeight = config.realDimensions.height;

  // portrait
  const portraitLayout = _calculateLayout(
    horizontalSpace,
    verticalSpace,
    spreadWidth,
    spreadHeight
  );

  return { 
    paperSize: {
      height: verticalSpace,
      width: horizontalSpace,
      // unit: 
    },
    gridLayout: portraitLayout,
    padding: 0, // TODO: figure out padding
  };

  // // landscape
  // const landscapeLayout = _calculateLayout(
  //   verticalSpace,
  //   horizontalSpace,
  //   spreadWidth,
  //   spreadHeight
  // );

  // if (
  //   portraitLayout.x * portraitLayout.y >= 
  //   landscapeLayout.x * landscapeLayout.y
  // ) {
  //   return { 
  //     paperSize: {
  //       height: verticalSpace,
  //       width: horizontalSpace,
  //       // unit: 
  //     },
  //     gridLayout: portraitLayout,
  //     padding: 10, // TODO: figure out padding
  //   };
  // } else {
  //   return { 
  //     paperSize: {
  //       height: horizontalSpace,
  //       width: verticalSpace,
  //       // unit: 
  //     },
  //     gridLayout: landscapeLayout,
  //     padding: 10, // TODO: figure out padding
  //   };
  // }
}


async function renderOnePage(layout: Layout, spreads: Filename[], out: Filename) {
  const { padding, gridLayout: { x, y } } = layout;
  const tileArgs = `${x}x${y}`;
  // const spacingArgs = `+${padding}+${padding}`;
  const args = [
    'montage',
    // TODO: figure out how to preserve colors
    // '-colorspace', 'sRGB',
    '-mode', 'concatenate',
    '-tile', tileArgs,
    // '-geometry', spacingArgs,
    // '-frame', '10x10',
    // '-matteColor', 'none',
    ...spreads,
    out,
  ];
  return magick({ args });
}

async function renderSpreads(layout: Layout, spreads: Filename[]) {
  const { gridLayout: { x, y } } = layout;
  const capacity = x * y; 
  const pages = [];
  
  let front = [];
  let back = [];


  for (let i = 0; i < spreads.length; i += 2) {
    // adding images to the front is easy; they just go in order
    // adding images to the back is harder, as we have to place right to left, top to bottom
    const row = Math.trunc(front.length / x);
    const column = front.length % x;
    
    front.push(spreads[i]);
    const reverseIdx = (row * x) + (x - column - 1);
    back[reverseIdx] = spreads[i+1]

    if (front.length === capacity) {
      const frontFilename = `${tempDir}/result-${pages.length}-front-${pages.length / 2}.png`;
      await renderOnePage(layout, front, frontFilename);
      pages.push(frontFilename);
      front = [];

      const backFilename = `${tempDir}/result-${pages.length}-back-${Math.trunc(pages.length / 2)}.png`;
      await renderOnePage(layout, back, backFilename);
      pages.push(backFilename);
      back = []
    }
  }

  if (front.length > 0) {
    // create filler image for empty space in "back" pic
    const filler = `${tempDir}/filler-spread.png`;
    for (let i = 0; i < back.length; i++) {
      if (!back[i]) {
        back[i]  = filler;
      }
    }
    
    const frontFilename = `${tempDir}/result-${pages.length}-front-${pages.length / 2}.png`;
    await renderOnePage(layout, front, frontFilename);
    pages.push(frontFilename);
    const backFilename = `${tempDir}/result-${pages.length}-back-${Math.trunc(pages.length / 2)}.png`;
    await renderOnePage(layout, back, backFilename);
    pages.push(backFilename);
  }

  return pages;
}
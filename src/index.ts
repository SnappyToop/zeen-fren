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
  .option('-v, --verbose', 'verbose mode')
  .parse(process.argv);

const opts = program.opts();

//TODO: set up temp directory correctly
const tempDir = 'tmp';

// 1. if config is passed, parse it and
// 1a. otherwise create a config from cmd line args
getConfig(opts).then(async config => {
  console.log(config);

  // 2. figure out image dimensions in pixels
  // const dimensions = await getDimensions(config.images[0]);
  
  // 3. generate crop commands to extract individual pages from input images
  const pages = await processInputImages(config, tempDir);
  console.log(pages);

  // 4. calculate most efficient layout
  const layout = await calculateLayout(config);
  console.log(layout);

  const out = await calculatePositions(pages, layout);
  // console.log(out.map(x => x.flat().join(' ')));

  const page = await mergeLayers(out);
  console.log(page)
  // 4. create new "spreads"
  // const spreads = await createSpreadsFromPages(pages, tempDir)
  // console.log(spreads);

  
  // 6. render spreads onto canvas
  // const bigPages = await renderSpreads(layout, spreads);
  // console.log(bigPages);

// 7. compile to pdf/tiff


});


async function getConfig(opts) {
  if (opts.config) {
    const file = await fs.readFile(opts.config, 'utf-8');
    return JSON.parse(file);
  }
}

async function getDimensions(image: Filename): Promise<Dimensions> {
  const response = await magick({
    args: ['identify', '-format', '%wx%h', image ],
    captureStdout: true
  });
  const [ widthStr, heightStr ] = response.split('x');
  const height = parseInt(heightStr, 10);
  const width = parseInt(widthStr, 10);
  console.log({response, height, width});
  return { height, width };
}

async function processImage(
  imagePath: Filename,
  dimensions: Dimensions,
  pane: Pane,
): Promise<string[]> {
  const { height, width } = dimensions;
  const cropOffset = pane === 'left' ? 0 : width;
  const cropArgs = `${width}x${height}+${cropOffset}+0`;
  const args = [ imagePath, '-gravity', 'west', '-crop', cropArgs, '+repage' ];
  return args;
}

async function processInputImages(
  config: Config,
  tempDir: Filename
): Promise<string[][]> {
  const { images } = config;
  const { width, height } = await getDimensions(images[0]);
  const pages: string[][] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // NOTE: we skip the left pane on the first page (unless backIsFirst option is specified, 
    // in which case, it is processes as the final image)
    if (i !== 0) {
      const leftFileName = `${tempDir}/page-${i * 2 - 1}.png`;
      const cmd = await processImage(image, { height, width: width / 2 }, "left");
      // TODO: handle errors
      // pages.push(leftFileName);
      pages.push(cmd);
    }

    // NOTE: as with above, we skip right pane on the last page (again, unless backIsFirst
    // option is specified, in which case the last page will have already been handled above)
    if (i !== images.length - 1) {
      const rightFileName = `${tempDir}/page-${i * 2}.png`;
      const cmd = await processImage(image, { height, width: width / 2 }, "right");
      // TODO: handle errors
      // pages.push(rightFileName);
      pages.push(cmd);
    }
  }
  return pages;
}


async function calculatePositions(pages: string[][], layout: Layout) {
  // while pages remain ... 
  //   assemble pages for front
  //     POP last page/command for front/left
  //     PUSH onto current row (current, left)
  //     SHIFT first page/command for front/right
  //     PUSH onto current row (current, left, right)
  //   assemble pages for back
  //     POP last page/command for back/right
  //     UNSHFIT onto current row (right, current)
  //     SHIFT first page/command for back/left
  //     UNSHFIT onto current row (left, right, current)
  //   if row is full
  //     +append (horiz) contents of into row
  //     -append (vert) contents onto page
  //   if page is full
  //     create new page

  // const pageGeometry = 
  // let pages = [];

  const imageWidth = 800;
  const imageHeight = 800;

  const numColumns = layout.gridLayout.x;
  const numRows = layout.gridLayout.y;
  console.log(numColumns, numRows);
  
  let row = 0, column = 0;

  let front = [], back = [];
  for (let i=0, j=pages.length-1; i < j; i+=2, j-=2) {
    console.log({ i, j });
    // POP last page/command for front/left
    const frontLeft = pages[j];
    const frontLeftOffset = {
      x: column * 2 * imageWidth,
      y: row * imageHeight,
    };
    console.log(frontLeft, frontLeftOffset);
    front.push([
      '(', ...frontLeft, ')',
      '-background', 'none',
      '-gravity', 'southeast',
      '-extent', `${frontLeftOffset.x + imageWidth}x${frontLeftOffset.y+imageHeight}`,
    ]);

    const frontRight = pages[i];
    const frontRightOffset = {
      x: ((column * 2) + 1) * imageWidth,
      y: row * imageHeight,
    };
    console.log(frontRight, frontRightOffset);
    front.push([
      '(', ...frontRight, ')',
      '-background', 'none',
      '-gravity', 'southeast',
      '-extent', `${frontRightOffset.x + imageWidth}x${frontRightOffset.y+imageHeight}`,
    ]);

    const backRight = pages[j-1];
    const backRightOffset = {
      x: imageWidth * (2 * (numColumns - column - 1)),
      y: row * imageHeight,
    }
    console.log(backRight, backRightOffset);
    back.push([
      '(', ...backRight, ')',
      '-background', 'none',
      '-gravity', 'southeast',
      '-extent', `${backRightOffset.x + imageWidth}x${backRightOffset.y+imageHeight}`,
    ])

    const backLeft = pages[i+1];
    const backLeftOffset = {
      x: imageWidth * (2 * (numColumns - column - 1) - 1),
      y: row * imageHeight,
    }
    console.log(backLeft, backLeftOffset);
    back.push([
      '(', ...backLeft, ')',
      '-background', 'none',
      '-gravity', 'southeast',
      '-extent', `${backLeftOffset.x + imageWidth}x${backLeftOffset.y+imageHeight}`,
    ])

    console.log(column, row);
    column ++;
    if (column === numColumns) {
      column = 0;
      row++;
    }
  }

  // TODO: allow for multiple pages!
  return [front, back];
}


async function mergeLayers(pages: string[][]) {
  for (let i=0; i<pages.length; i++) {
    // console.log(pages[i]);
    const args = [
      ...(pages[i].map(page => ['(', ...page, ')'])).flat(),
      '-gravity', 'northwest',
      '-layers', 'mosaic',

      // '(', ...pages[i][0], ')',
      // '-gravity', 'northeast',
      // '(', ...pages[i][1], ')',
      // '-gravity', 'northeast',
      // '-composite',
      `${tempDir}/page-${i}.png`,
    ];

    console.log(args);
    console.log(await magick({ args }));
  }


  
}



async function createSpread(
  left: Filename,
  right: Filename,
  outFile: Filename
) {
  const args = [
    left,
    right,
    '+append',
    outFile
  ].flat();
  console.log(args, args.join(' '));
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
    await createSpread(left, right, outFile)
    spreads.push(outFile);
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
  const verticalSpace = (config.paperSize?.dimensions?.height || 11) - marginY;

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
    imageSize: { 
      height: 800,
      width: 800,
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
  const { x, y } = layout.gridLayout;
  const tileArgs = `${x}x${y}`;
  const args = [
    'montage',
    '-mode', 'concatenate',
    '-tile', tileArgs,
    ...spreads,
    out,
  ];
  console.log(args);
  return magick({ args });
}

async function createFiller(out: Filename, dimensions: Dimensions) {
  // const geomtry = await ()
  const args = [
    'convert',
    '-size', `${dimensions.width}x${dimensions.height}`,
    'xc:transparent',
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
    const frontIdx = front.length;
    front.push(spreads[i]);

    // adding images to the back is harder, as we have to place right to left, top to bottom
    const row = Math.trunc(frontIdx / x);
    const column = frontIdx % x;
    const reverseIdx = (row * x) + (x - column - 1);
    console.log({ row, column, frontIdx, backIdx: reverseIdx});
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
    const fillerDimensions = await getDimensions(spreads[0]);
    const fillerImage = `${tempDir}/filler.png`;
    await createFiller(fillerImage, fillerDimensions);

    for (let i = 0; i < back.length; i++) {
      if (!back[i]) {
        back[i]  = fillerImage;
      }
    }

    console.log(front, back);
    
    const frontFilename = `${tempDir}/result-${pages.length}-front-${pages.length / 2}.png`;
    await renderOnePage(layout, front, frontFilename);
    pages.push(frontFilename);
    const backFilename = `${tempDir}/result-${pages.length}-back-${Math.trunc(pages.length / 2)}.png`;
    await renderOnePage(layout, back, backFilename);
    pages.push(backFilename);
  }

  return pages;
}
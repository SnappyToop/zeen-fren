import fs from 'fs/promises';
import { program } from 'commander';
import magick from "./magick";

type Filename = string;

type Dimensions = {
  height: number,
  width: number,
  unit?: 'inches' | 'in' | 'cm',
};

type Coordinates = { x: number, y: number };

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
  // NOTE: this output can also be used to generate thumbnails

  // 4. calculate most efficient layout
  const layout = await calculateLayout(config);
  console.log(layout);

  // 5. determine final position on the page for each cropped page and express
  //    as an imagemagick command
  const out = await calculatePositions(pages, layout);
  // console.log(out.map(x => x.flat().join(' ')));

  // 6. execute the commands and render into pages
  const page = await mergeLayers(out);
  console.log(page)


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
  const offset = pane === 'left' ? 0 : width;
  const region = `${width}x${height}+${offset}+0`;
  const args = [ imagePath, '-extract', region, '+repage' ];
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


function genPosition(base: string[], position: Coordinates, imageDimensions: Dimensions) {
  const x = imageDimensions.width * (position.x + 1);
  const y = imageDimensions.height * (position.y + 1);
  return [
    '(', ...base, ')',
    '-background', 'none',
    '-extent', `${x}x${y}`,
  ];
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

  // 5100x3300
  // const imageWidth = 800;
  // const imageHeight = 800;
  
  // const imageDimeniosn = { width: 2550, height: 3300 };
  const imageDimeniosn = { width: 800, height: 800 };

  const numColumns = layout.gridLayout.x;
  const numRows = layout.gridLayout.y;
  console.log(numColumns, numRows);
  
  let row = 0, column = 0;

  let front = [], back = [];
  for (let i=0, j=pages.length-1; i < j; i+=2, j-=2) {
    
    // front left
    front.push(
      genPosition(
        pages[j], 
        { x: column * 2, y: row },
        imageDimeniosn,
      )
    );

    // front right
    front.push(
      genPosition(
        pages[i], 
        { x: (column * 2) + 1, y: row },
        imageDimeniosn,
      )
    );
    
    // back right 
    back.push(
      genPosition(
        pages[j-1], 
        { x: (2 * (numColumns - column) - 1), y: row },
        imageDimeniosn,
      )
    );

    // back left 
    back.push(
      genPosition(
        pages[i+1], 
        { x: 2 * (numColumns - column - 1), y: row  },
        imageDimeniosn,
      )
    );

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
      // gravity southwest is applied to create the offsets
      '-gravity', 'southeast',
      ...(pages[i].map(page => ['(', ...page, ')'])).flat(),
      // gravity northwest is set to merge the players
      '-gravity', 'northwest',
      '-layers', 'mosaic',
      `${tempDir}/page-${i}.png`,
    ];

    console.log(args);
    console.log(await magick({ args }));
  }  
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


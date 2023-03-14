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
  columns: number,
  // realDimensions: Dimensions,
  paperSize: {
    width?: number,
    height?: number,
    margin?: number,
    marginX?: number,
    marginY?: number,
    marginLeft?: number,
    marginRight?: number,
    marginTop?: number,
    marginBotton?: number,
    offsetX?: number,
    offsetY?: number,
    gutter?: number,
    unit?: string,
  },
  format?: 'spread' | 'page',
};

type Layout = {
  // paperSize: Dimensions,
  gridLayout: {
    x: number,
    y: number,
  },
  marginPixels: {
    marginLeft: number,
    marginRight: number,
    marginTop: number,
    marginBotton: number,
  }, offsetPixels: {
    offsetX: number,
    offsetY: number,
  },
  gutterPixels: number,
};

type Command = string[];

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
  const dimensions = await getDimensions(config.images[0]);
  
  // 3. generate crop commands to extract individual pages from input images
  const pages = await processInputImages(config, dimensions);
  console.log(pages);
  // NOTE: this output can also be used to generate thumbnails

  // 4. calculate most efficient layout
  const layout = await calculateLayout(config, dimensions);
  console.log(layout);

  // 5. determine final position on the page for each cropped page and express
  //    as an imagemagick command
  const gridPositions = calculatePositions(pages, layout);
  console.log(gridPositions);

  // 6. execute the commands and render into pages
  const finalPages = await combinePages(gridPositions, layout);
  console.log(finalPages)


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

function processImage(
  imagePath: Filename,
  dimensions: Dimensions,
  pane: Pane,
): string[] {
  const { height, width } = dimensions;
  const offset = pane === 'left' ? 0 : width;
  const region = `${width}x${height}+${offset}+0`;
  const args = [ imagePath, '-crop', region, '+repage' ];
  return args;
}

function processInputImages(
  config: Config,
  dimensions: Dimensions,
): Command[] {
  const { images } = config;
  const { width, height } = dimensions; 
  const pages: string[][] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // NOTE: we skip the left pane on the first page (unless backIsFirst option is specified, 
    // in which case, it is processes as the final image)
    if (i !== 0) {
      pages.push(processImage(image, { height, width: width / 2 }, "left"));
    }

    // NOTE: as with above, we skip right pane on the last page (again, unless backIsFirst
    // option is specified, in which case the last page will have already been handled above)
    if (i !== images.length - 1) {
      pages.push(processImage(image, { height, width: width / 2 }, "right"));
    }
  }
  return pages;
}

function calculateLayout(config: Config, imageDimensions: Dimensions) {
  const { columns, paperSize } = config;

  console.log(paperSize);
  const marginLeft = paperSize.marginLeft || paperSize.marginX || paperSize.margin || 0;
  const marginRight = paperSize.marginRight || paperSize.marginX || paperSize.margin || 0;
  const marginTop = paperSize.marginTop || paperSize.marginY || paperSize.margin || 0;
  const marginBotton = paperSize.marginBotton || paperSize.marginY || paperSize.margin || 0;
  
  const paperWidth = paperSize.width || 8.5;
  const paperHeight = paperSize.height || 11;

  // const spreadWidth = 2 * (config.realDimensions.width);
  // const spreadHeight = config.realDimensions.height;

  const availableWidth = paperWidth - marginLeft - marginRight;
  const availableHeight = paperHeight - marginTop - marginBotton;

  console.log(availableWidth, availableHeight);
  console.log(imageDimensions);

  const pixelsPerInch = ( columns * imageDimensions.width ) / availableWidth;
  console.log(pixelsPerInch)
  const rows = Math.floor((availableHeight * pixelsPerInch)/ imageDimensions.height);

  console.log({ columns, rows });
  
  return {
    gridLayout: {
      x: columns,
      y: rows,
    },
    marginPixels: {
      marginLeft: marginLeft * pixelsPerInch,
      marginRight: marginRight * pixelsPerInch,
      marginTop: marginTop * pixelsPerInch,
      marginBotton: marginBotton * pixelsPerInch,
    },
    offsetPixels: {
      offsetX: (paperSize.offsetX || 0) * pixelsPerInch,
      offsetY: (paperSize.offsetX || 0) * pixelsPerInch,
    },
    gutterPixels: (paperSize.gutter || 0) * pixelsPerInch,
  };

}

function calculatePositions(pages: string[][], layout: Layout): Command[][][] {
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

  const numColumns = layout.gridLayout.x;
  const numRows = layout.gridLayout.y;
  
  let row = 0, column = 0;
  let front: Command[][] = [[]], back: Command[][] = [[]];
  const out: Command[][][] = [];

  for (let i=0, j=pages.length-1; i < j; i+=2, j-=2) {
    if (column === numColumns) {
      row++;
      column = 0;
      if (row < numRows) {
        front[row] = [];
        back[row] = [];
      } else {
        out.push(front, back);
        front = [[]];
        back = [[]];
        row = 0;
      }
    }

    front[row][column*2] = pages[j]; // front left
    front[row][column*2+1] = pages[i]; // front right
    back[row][(2 * (numColumns - column) - 1)] = pages[j-1]; // back right 
    back[row][ 2 * (numColumns - column - 1)] = pages[i+1]; // back left 

    column++;
  }

  out.push(front, back);
  return out;
}

async function combinePages(pages: Command[][][], layout: Layout): Promise<Filename[]> {
  const {
    marginLeft,
    marginRight,
    marginTop,
    marginBotton,
  } = layout.marginPixels;
  const { 
    offsetX,
    offsetY,
  } = layout.offsetPixels;
  const { gutterPixels } = layout;
  
  // console.log(marginRight, offsetX);
  // console.log('-splice', `${marginRight - offsetX}x${marginBotton - offsetY}`)
  // console.log('-splice', `${marginLeft + offsetX}x${marginTop + offsetY}`,)


  // return [];

  return Promise.all(pages.map(async (page, i) => {
    const left = marginLeft + offsetX + (i % 2 === 0 ? 1 : -1) * gutterPixels;
    const right = marginRight - offsetX - (i % 2 === 0 ? 1 : -1) * gutterPixels;
    const top = marginTop + offsetY;
    const bottom = marginBotton - offsetY;

    console.log({ left, right, top, bottom});
    // return;
    
    const filename = `${tempDir}/page-${i}.png`;
    const args = [
      '-background', 'none',
      ...(page.flatMap(row => [
        '(',
        ...row.flatMap(cmd => ['(', ...cmd, ')']),
        '+append',
        ')'
      ])),
      '-gravity', i % 2 === 0 ? 'west': 'east',
      '-append',
      '-gravity', 'northwest',
      '-splice', `${right}x${bottom}`,
      '-gravity', 'southeast',
      '-splice', `${left}x${top}`,
      filename,
    ];
    console.log(args);
    await magick({ args });
    return filename;
  }));
}


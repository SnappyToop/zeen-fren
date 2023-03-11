import fs from 'fs/promises';
import { program } from 'commander';
import magick from "./magick";

type Filename = string;

type Dimensions = {
  height: number,
  width: number,
};

type Pane = 'right' | 'left';

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
  const pages = await processInputImages(config.images, dimensions, tempDir);
  console.log(pages);

  // 4. create new "spreads"
  const spreads = await createSpreadsFromPages(pages, tempDir)
  console.log(spreads);

// 5. calculate most efficient layout

// 6. render spreads onto canvas

// 7. compile to pdf/tiff


});


async function getConfig(opts: OptsType) {
  if (opts.config) {
    const file = await fs.readFile(opts.config, 'utf-8');
    return JSON.parse(file);
  }
}

async function getDimensions(images: Filename[]) {
  // TODO: examine files and determine dimensions programatically
  const height = 800;
  const width = 800;
  return { height, width };
}

async function processImage(
  imagePath: Filename,
  dimensions: Dimensions,
  pane: Pane,
  outFile: Filename,
): Promise<boolean> {
  const { height, width } = dimensions;
  const cropOffset = pane === 'left' ? 0 : width;
  const cropArgs = `${width}x${height}+${cropOffset}+0`;
  const args = [ imagePath, '-crop', cropArgs, outFile ];
  return magick({ args });
}

async function processInputImages(
  images: Filename[],
  dimensions: Dimensions,
  tempDir: Filename
) {
  const pages: Filename[] = [];
  // await images.forEach(async (image, idx) => {
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // NOTE: we skip the left pane on the first page (unless backIsFirst option is specified, 
    // in which case, it is processes as the final image)
    if (i !== 0) {
      const leftFileName = `${tempDir}/page-${i * 2 - 1}.png`;
      if (!await processImage(image, dimensions, "left", leftFileName)) {
        // TODO: handle errors
      }
      console.log(leftFileName);
      pages.push(leftFileName);
    }

    // NOTE: as with above, we skip right pane on the last page (again, unless backIsFirst
    // option is specified, in which case the last page will have already been handled above)
    if (i !== images.length - 1) {
      const rightFileName = `${tempDir}/page-${i * 2}.png`;
      if (!await processImage(image, dimensions, "right", rightFileName)) {
        // TODO: handle errors
      }
      // TODO: handle errors
      console.log(rightFileName);
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
  // magick montage -mode concatenate -tile x1  out2.png out.png montage.png
  const cmd = 'magick';
  const args = ['montage', '-mode', 'concatenate', '-tile', 'x1', left, right, outFile];
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
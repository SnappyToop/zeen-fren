import { execFile } from "child_process";

type ArgType = {
  args: string[],
  cmd?: string,
};

export default async function magick({
  args,
  cmd = 'magick',
}: ArgType): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const process = execFile(cmd, args);
    process.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        // TODO: handle errors
        // TODO: read stderr and reject with that string
        reject('errp!')
      }
    });
  });
}
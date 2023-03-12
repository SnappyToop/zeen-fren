import { execFile } from "child_process";

type ArgType = {
  args: string[],
  cmd?: string,
  captureStdout?: boolean,
  verbose?: boolean,
};

export default async function magick({
  args,
  cmd = 'magick',
  captureStdout = false,
  verbose = false,
}: ArgType): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args);
    
    let stdout: string;
    if (captureStdout && child.stdout) {
      stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (verbose && child.stderr) {
      child.stderr.on('data', (data) => {
        console.error(data);
      });
    }
        
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // console.error(`exit code: ${code}`);
        reject(`exit code: ${code}`);
      }
    });
  });
}
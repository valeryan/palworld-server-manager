declare module "tree-kill" {
  export default function kill(
    pid: number,
    signal?: string,
    callback?: (error?: Error) => void,
  ): void;
}

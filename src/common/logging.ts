function consoleLog(...args: any[]) {
  if(process.env.MONOCLE_DEBUG === 'true') {
    console.log(...args);
  }
}

export { consoleLog };
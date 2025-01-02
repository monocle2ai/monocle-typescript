exports.consoleLog = function consoleLog(message) {
  if(process.env.MONOCLE_DEBUG === 'true') {
    console.log(message);
  }
}
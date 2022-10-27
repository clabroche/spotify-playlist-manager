const args = process.argv.slice(2)
console.log(args)
module.exports = {
  isPreviewMode: args.includes('--preview'),
  isEditable: args.includes('--editable'),
}
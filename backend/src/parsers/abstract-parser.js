export class AbstractParser {
  constructor(name) {
    this.name = name;
  }

  /**
   * Parse uploaded files and run the mapping logic.
   * @param {Object} files - Map of files (e.g. { visitsFile: 'path', staffFile: 'path' })
   * @param {Object} options - Custom parameters (e.g. threshold)
   * @param {Function} log - Progress logging callback function (takes string message)
   * @returns {Promise<Object>} Object containing outputFilePath and optional data lists/tables
   */
  async parse(files, options, log) {
    throw new Error(`Parser ${this.name} must implement the parse method.`);
  }
}

/**
 * Copyright (C) 2020  greyliances and TobidieTopfpflanze
 * See https://github.com/GTM-BE/PaperID#LICENSE for more information
 */

const FileSystem = require('fs-extra');
const Path = require('path');
const archiver = require('archiver');

const glyphs = require('./glyph_translation');
const manifest = require('./resources/manifest');
const tiles = require('./resources/tiles');
const version = require(Path.join(__dirname, "..", '/package.json')).version.split(".").map(el => Number(el));

const outDir = Path.join(__dirname, "..", "output")
const packDirName = `PaperID v${version.join('.')}`;

/**
 * The .lang files we found in the input folder
 * en_US.lang turns into en_US
 */
const foundLanguages = [];

/**
 * Credit for this function goes to
 * https://gist.github.com/jed/982883
 */
const genUUID = (a = '') =>
  a
    ? ((Number(a) ^ (Math.random() * 16)) >> (Number(a) / 4)).toString(16)
    : `${1e7}-${1e3}-${4e3}-${8e3}-${1e11}`.replace(/[018]/g, genUUID);

/**
 * Recursively find files within a folder
 * @param {Path} folderPath
 */
const getFilePaths = (folderPath) => {
  const entries = FileSystem.readdirSync(folderPath).map((entries) =>
    Path.join(folderPath, entries)
  );
  const dirPath = entries.filter((entry) =>
    FileSystem.statSync(entry).isFile()
  );
  const dirFiles = entries
    .filter((entry) => !dirPath.includes(entry))
    .reduce((entry, entries) => entry.concat(getFilePaths(entries)), []);
  return [...dirPath, ...dirFiles];
};

/**
 * Remove the old output if it exists
 * and ensure its existence afterwards, we always want to start on
 * a clean folder
 */
if (FileSystem.existsSync(Path.join(outDir))) {
  FileSystem.rmSync(Path.join(outDir), {
    recursive: true
  });
}

/**
 * Prepare the texts folder where the new lang files go
 */
FileSystem.mkdirSync(Path.join(outDir, packDirName, "texts"), {recursive: true});

/**
 * Default FS doesn't let me copy whole folders recursively so
 * FSExtra is used to copy the font folder which contains multiple files like
 * the glyphs and font i want to use
 */
FileSystem.copySync(
  Path.join(__dirname, "resources", "font"),
  Path.join(outDir, packDirName, "font")
);

/**
 * Prepare the Header of the manifest. All the other fields
 * are hardcoded but the Version shouldn't be for obvious
 * semantic reasons
 *
 * And the UUID of course has to be unique
 */
manifest.header.uuid = genUUID();
manifest.header.version = version;
manifest.header.name = `PaperID v${version.join('.')}`;

/**
 * Same for the module
 */
manifest.modules[0].uuid = genUUID();
manifest.modules[0].version = version;

/**
 * We bumped the manifest file, lets write it to the output folder
 */
FileSystem.writeFileSync(
  Path.join(outDir, packDirName, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  { encoding: 'utf8' }
);

/**
 * Reads a lang file and modifies it to show the new Data
 * @param {Path} inputPath
 */
const generateLangFile = (inputPath) => {
  /**
   * Placeholder for new translated Tiles
   */
  const convertedTileEntries = [];
  const convertedTileEntriesBlockStates = [];

  /**
   * Not yet translated tiles
   */
  const tileEntries = [];

  /**
   * Anything that didn't match the tile. or item. scope
   */
  const otherEntries = [];

  /**
   * Keeps the raw key names that we want
   */
  const tileSetKeys = [];

  const langFile = FileSystem.readFileSync(inputPath, { encoding: 'utf8' });

  /**
   * Keep track of the files we found, as we need them all to generate the
   * language_names.json and languages.json Files with that info
   */
  foundLanguages.push(
    `${inputPath.split(/\\|\//g).pop().split('.').shift()}.s`
  );

  foundLanguages.push(inputPath.split(/\\|\//g).pop().split('.').shift());

  /**
   * We sort the .lang file into a set of tile entries and one
   * that holds all entries that aren't about tile
   */
  langFile
    .split(/\n|\r\n/g)
    .forEach((langFileLine) =>
      langFileLine.startsWith('tile.') || langFileLine.startsWith('item.')
        ? tileEntries.push(langFileLine)
        : otherEntries.push(langFileLine)
    );

  tileEntries.forEach((entry) => {
    /**
     * This is the name an Item has
     */
    const tileName = entry.split('=').pop();

    const tileKey = entry
      .replace(/(?:^tile\.)|(?:^item\.)/, '')
      .replace(/\.name.{1,}$/, '');

    if (/\..{1,}=.{1,}$/.test(tileKey)) {
      /**
       * Looks like this isn't a tile entry for a Name
       * - -> tile.netherreactor.active=Active!
       * + -> tile.netherreactor.name=Nether Reactor Core
       *
       * If the entry still has an assignment after trying to remove
       * everything after the .name Part, then clearly this is one of
       * those cases where its a message/string thats related to a block but
       * not the name itself
       *
       * Since we do not want to remove .lang entries, we pump them into
       * the set for non-tile lines
       */

      otherEntries.push(entry);
      return;
    }

    tileSetKeys.push({
      key: tileKey,
      name: tileName,
      type: entry.startsWith('tile.') ? 'tile' : 'item',
      entry
    });
  });

  const tileSet = [];

  tileSetKeys.forEach(({ key, name, type, entry }) => {
    if (type === 'item') {
      if (tiles[key]) {
        /**
         * This is an item that we ALSO want to give ID data
         * This is the case for any Block that is represented by an item
         * in the inventory such as doors, crops, beds etc
         */
        tileSet.push({
          ...tiles[key],
          tile: key,
          name
        });
      } else {
        otherEntries.push(entry);
      }
    } else {
      if (tiles[key]) {
        tileSet.push({
          ...tiles[key],
          tile: key,
          name
        });
      } else {
        console.log(`Language file entry ${key} is unknown!`);
      }
    }
  });

  /**
   * Now that we got all the relevant data to rewrite a language file, we can
   * start assembling a list of tile entries that will be joined to
   * one big string / file later
   */
  tileSet.forEach(
    ({ tile, name, id, meta, namespace, isItem, isBedrockOnly }) => {
      const [preName, afterName] = (namespace || '').split('|');
      convertedTileEntriesBlockStates.push(
        `${isItem ? 'item' : 'tile'}.${tile}.name=${name
          .replace(/#$/, '')
          .trim()}${
          isBedrockOnly
            ? `${glyphs.error} Bedrock Exclusive `
            : `${
                !id || id > 255
                  ? ''
                  : `${glyphs.id} ${id}:${meta ?? glyphs.error} `
              }${
                namespace
                  ? `${glyphs.namespace} ${preName.trim()}${
                      afterName
                        ? `${glyphs.block_state} ${afterName
                            .replace(
                              /\$:[a-z0-9_]{1,}/g,
                              (match) =>
                                `${glyphs[match.replace('$:', '').trim()]} `
                            )
                            .trim()}`
                        : ''
                    }`
                  : `${glyphs.error} Unknown `
              }`
        }`
      );

      convertedTileEntries.push(
        `${isItem ? 'item' : 'tile'}.${tile}.name=${name
          .replace(/#$/, '')
          .trim()}${
          isBedrockOnly
            ? `${glyphs.error} Bedrock Exclusive `
            : `${
                !id || id > 255
                  ? ''
                  : `${glyphs.id} ${id}:${meta ?? glyphs.error} `
              }${
                namespace
                  ? `${glyphs.namespace} ${preName.split('§8[')[0].trim()}`
                  : `${glyphs.error} Unknown`
              }`
        }`
      );
    }
  );

  FileSystem.writeFileSync(
    Path.join(
      outDir,
      `${packDirName}/texts/${inputPath
        .split(/\\|\//g)
        .pop()
        .split('.')
        .shift()}.p.lang`
    ),
    [...convertedTileEntries, ...otherEntries].map(el => el.trim()).join('\n')
  );

  FileSystem.writeFileSync(
    Path.join(
      outDir,
      `${packDirName}/texts/${inputPath
        .split(/\\|\//g)
        .pop()
        .split('.')
        .shift()}.s.lang`
    ),
    [...convertedTileEntriesBlockStates, ...otherEntries].map(el => el.trim()).join('\n')
  );

  console.log(
    `Compiled a new language ${inputPath
      .split(/\\|\//g)
      .pop()
      .split('.')
      .shift()}.p.lang, ${inputPath
      .split(/\\|\//g)
      .pop()
      .split('.')
      .shift()}.s.lang`
  );
};

getFilePaths(Path.join(__dirname, "..", "input")).forEach((path) =>
  generateLangFile(path)
);

const compiledLangSet = [];
const namespacedLanguages = [];

foundLanguages.forEach((language) => {
  if (language.endsWith('.s')) {
    compiledLangSet.push([
      language,
      `§a[${language.replace(/\.(?:s|p)$/, '')}]§f v${version.join(
        '.'
      )} Modified to show Java IDs & Namespaces as well as some block states`
    ]);
    namespacedLanguages.push(language);
  } else {
    compiledLangSet.push([
      `${language}.p`,
      `§a[${language.replace(/\.(?:s|p)$/, '')}]§f v${version.join(
        '.'
      )} Modified to show Java IDs & Namespaces`
    ]);
    namespacedLanguages.push(`${language}.p`);
  }
});

FileSystem.copyFileSync(
  Path.join(__dirname, "resources", "pack_icon.png"),
  Path.join(outDir, packDirName, "pack_icon.png")
);

FileSystem.writeFileSync(
  Path.join(outDir, packDirName, "texts", "language_names.json"),
  JSON.stringify(compiledLangSet, null, 2),
  { encoding: 'utf8' }
);

FileSystem.writeFileSync(
  Path.join(outDir, packDirName, "texts", "languages.json"),
  JSON.stringify(namespacedLanguages, null, 2),
  { encoding: 'utf8' }
);

console.log(`Create "PaperID v${version.join('.')}.mcpack"`)

const output = FileSystem.createWriteStream(Path.join(outDir, `PaperID v${version.join('_')}.zip`));
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});

output.on('close', () => {
  console.log(Math.floor(archive.pointer() / 1014) + ' MB written...');
  FileSystem.copyFileSync(Path.join(outDir, `PaperID v${version.join('_')}.zip`), Path.join(outDir, `PaperID v${version.join('_')}.mcpack`))
});


archive.pipe(output);

archive.directory(Path.join(outDir, packDirName), `PaperID v${version.join('.')}`);

archive.finalize();
const {dependencies} = require('./package.json'),
      gulp = require('gulp'),
      multipipe = require('multipipe'),
      path = require('path'),
      browserify = require('browserify'),
      browserSync = require('browser-sync'),
      reload = browserSync.reload,
      source = require('vinyl-source-stream'),
      _ = require('lodash'),
      {
        autoprefixer,
        cached,
        changed,
        clean,
        concat,
        imagemin,
        jshint,
        less,
        lessReporter,
        minifyCss,
        minifyHtml,
        pipe,
        print,
        remember,
        revAll,
        sequence,
        sourcemaps,
        spritesmith,
        tasks,
        uglify,
        util
      } = require('gulp-load-plugins')();

const result = tasks(gulp, require);
if (typeof result === 'string') console.log(result);

let p = name => print(file => console.log(name, file));

gulp.task('default', ['build']);

gulp.task('build', sequence('clean',
                            'application',
                            'minify',
                            'rev'));

gulp.task('clean',  ['clean:rev', 'clean:dist']);
gulp.task('application', ['js', 'html', 'images', 'styles', 'fonts']);
gulp.task('js',     ['js:vendor', 'js:app']);
gulp.task('minify', ['minify:css', 'minify:html', 'minify:js', 'minify:images']);

gulp.task('dev', cb => {
  const {src} = paths;

  sequence('clean:dev',
          ['js:vendor', 'js:app', 'html', 'images'],
          'styles',
          'browser-sync')(cb);

  watch(src.vendor,    ['js:vendor']);
  watch(src.scripts,   ['js:app']);
  watch(src.templates, ['js:app']);
  watch(src.html,      ['html']);
  watch(src.images,    ['images']);
  watch(src.less,      ['styles'])
    .on('change', ({type, path}) => {
      if (type === 'deleted') {
        delete cached.caches['styles'][path];
        remember.forget('styles', path);
      }
    });

  function watch(folder, tasks) {
    console.log(`Watching ${folder}`);
    return gulp.watch(folder, tasks);
  }
});

gulp.task('browser-sync',
  () => browserSync({
    server: paths.dev.$,
    ghostMode: false
  }));

gulp.task('js:vendor',
  () => pipe([
    browserify()
      .require(_.keys(dependencies))
      .bundle()
    ,source('vendor.js')
    ,p('js:vendor')
    ,gulp.dest(paths.dev.$)
    ,reload({stream: true})
  ]));

gulp.task('js:app', ['js:lint'],
  () => pipe([
    browserify({
      entries: [paths.src.app],
      debug: true
    })
      .external(_.keys(dependencies))
      .bundle()
      .on('error', function(err) { // Cannot use => syntax here, as `this` must be set by the caller
        console.log('js:app error', err, err.stack);
        this.emit('end');
      })
    ,source('app.js')
    ,gulp.dest(paths.dev.$)
    ,reload({stream: true})
  ]));

gulp.task('js:lint',
  () => pipe([
    gulp.src(paths.src.scripts)
    ,cached('js:lint')
    ,p('js:lint')
    ,jshint()
    ,jshint.reporter('jshint-stylish')
    ,jshint.reporter('fail')
  ]));

gulp.task('styles', ['less:concat']);

gulp.task('less:concat', ['less:debug'],
  () => pipe([
    gulp.src(paths.dev.styles)
    ,p('less:concat:pre')
    ,concat('app.css')
    ,p('less:concat:post')
    ,gulp.dest(paths.dev.$)
    ,reload({stream: true})
  ]));

gulp.task('less:debug', ['sprites'],
  () => multipipe( // my gulp-pipe fails here because of the less().on [doesn't forward errors]
    gulp.src(paths.src.less)
    ,cached('less')
    ,p('less:debug')
    ,sourcemaps.init()
    ,less()
      .on('error', lessReporter)
    ,autoprefixer()
    ,sourcemaps.write()
    ,remember('less')
    ,concat('tmp.css')
    ,gulp.dest(paths.dev.$)
  ));

gulp.task('sprites',
  () => pipe([
    gulp.src(paths.src.images)
    ,p('sprites:pre')
    ,spritesmith({
      imgName: './sprites.png',
      cssName: './sprites.css',
      cssTemplate:
        ({sprites, spritesheet}) => {
          return _.map(sprites, sprite => {
            const {name, offset_x, offset_y, width, height} = sprite,
                  position = {x: 100 * offset_x / width, y: 100 * offset_y / height},
                  size = {x: 100 * spritesheet.width / width, y: 100 * spritesheet.height / height};
            return `.sprite-${name} { background-image: url('${spritesheet.image}'); background-position: ${position.x}% ${position.y}% ; background-size: ${size.x}% ${size.y}%; width: 100%; height: 100%; }`;
          }).join('\n');
        },
      cssOpts: {cssSelector: ({name}) => `.sprite-${name}`}
    })
    ,p('sprites:post')
    ,gulp.dest(paths.dev.$)
  ]));

gulp.task('html',
  () => pipe([
    gulp.src(paths.src.html)
    ,p('html')
    ,gulp.dest(paths.dev.$)
    ,reload({stream: true})
  ]));

gulp.task('images',
  () => pipe([
    gulp.src(paths.src.images)
    ,changed(paths.dev.$)
    ,p('images')
    ,gulp.dest(paths.dev.$)
    ,reload({stream: true})
  ]));

gulp.task('fonts');

gulp.task('rev',
  () => pipe([
    gulp.src([paths.rev.$all])
    ,p('rev:pre')
    ,(new revAll({
      dontRenameFile: ['index\.html'],
      dontSearchFile: ['vendor.js']
    })).revision()
    ,p('rev:post')
    ,gulp.dest(paths.dist.$)
  ]));

((task) => {
  _.each({
    css:    {fn: minifyCss},
    js:     {fn: uglify, src: ({dev}) => [dev.app].concat([dev.vendor])},
    html:   {fn: () => minifyHtml({quotes: true})},
    images: {fn: imagemin, src: ({dev}) => [dev.sprites]}
  }, ({dest, fn, src}, part) => {
    let name = `${task}:${part}`;
    gulp.task(name,
      () => (({dev, rev}) =>
        pipe([
          gulp.src((src || (() => ([dev[part]])))(paths))
          ,p(name)
          ,fn()
          ,gulp.dest(dest || rev.$)])
      )(paths));

  });
})('minify'); // Is there a way to get 'minify' to occur before the code...without verbosity?

((task) => _.each(['dev', 'dist', 'rev'],
  version =>
    gulp.task(`${task}:${version}`,
      () => pipe([
        gulp.src(paths[version].$, {read: false})
        ,clean()
      ]))
))('clean');

const paths = ((base) => ({
  src: {
    $: `${base}/src`,
    app: [`${base}/src/app.js`],
    less: [`${base}/src/**/*.less`],
    html: [`${base}/src/index.html`],
    images: [`${base}/src/**/*.{svg,gif,png,jpg}`],
    scripts: [`${base}/src/**/*.js`],
    templates: [`${base}/src/modules/**/template.html`],
    vendor: [`!${base}/node_modules/*/node_modules/**`]
            .concat(_.map(dependencies, (version, dependency) => `${base}/node_modules/${dependency}/**/*.js`)),
  },
  dev: {
    $: `${base}/.dev`,
    $all: `${base}/.dev/**`,
    app: `${base}/.dev/app.js`,
    css: `${base}/.dev/app.css`,
    html: `${base}/.dev/index.html`,
    images: `${base}/.dev/**/*.{svg,gif,png,jpg}`,
    sprites: `${base}/.dev/sprites.png`,
    vendor: `${base}/.dev/vendor.js`,
    styles: [`${base}/.dev/tmp.css`, `${base}/.dev/sprites.css`]
  },
  rev: {
    $: `${base}/.rev`,
    $all: `${base}/.rev/**`
  },
  dist: {
    $: `${base}/.dist`,
    app: `${base}/.dist/app.js`,
    css: `${base}/.dist/app.css`,
    html: `${base}/.dist/index.html`
  }
}))(`./projects/${process.argv[4]}` || '.');
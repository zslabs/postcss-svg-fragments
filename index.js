var fs      = require('fs-promise');
var parser  = require('postcss-value-parser');
var path    = require('path');
var postcss = require('postcss');
var xmldoc  = require('xmldoc');

var matchURL  = /(^|\s)url\(.+\.svg#.+\)(\s|$)/;
var matchProp = /^(color|fill|height|stroke|stroke-width|width)$/;

module.exports = postcss.plugin('postcss-svg-fragments', function (opts) {
	// configure options
	var isBase64 = opts && opts.encoding === 'base64';

	return function (css, result) {
		// create a css promises array
		var cssPromises = [];

		// create an svg promises array
		var svgPromises = [];

		// create array with modified declarations
		var modifiedDecls = [];

		// walk declarations
		css.walkDecls(function (decl) {
			// if the declaration has a url
			if (!matchURL.test(decl.value)) {
				return;
			}

			modifiedDecls.push(decl);

			// cache the declaration’s siblings
			var parent = decl.parent;

			// walk each node of the declaration
			decl.value = parser(decl.value).walk(function (node) {
				// if the node is a url containing an svg fragment
				if (
					node.type !== 'function' ||
					node.value !== 'url' ||
					node.nodes.length === 0 ||
					node.nodes[0].value.indexOf('.svg#') === -1
				) {
					return;
				}

				// get the closest working file path of the node
				var cwf = decl.source.input.file;

				// set the directory b the closest
				var dir  = cwf ? path.dirname(cwf) : process.cwd();

				// parse the svg url
				var url   = node.nodes[0];
				var parts = url.value.split('#');
				var file  = path.join(dir, parts.shift());
				var id    = parts.join('#');

				// get cached svg promise
				var svgPromise = svgPromises[file] = svgPromises[file] || fs.readFile(file, {
					encoding: 'utf8'
				}).then(function (content) {
					// return an xml tree of the svg
					var document = new xmldoc.XmlDocument(content);

					document.ids = {};

					return document;
				});

				// push a modified svg promise to the declaration promises array
				cssPromises.push(svgPromise.then(function (document) {
					// cache fragment by id
					document.ids[id] = document.ids[id] || getElementById(document, id);

					// if the fragment id exists
					if (document.ids[id]) {
						// get cloned fragment
						var clone = cloneNode(document.ids[id]);

						// walk each sibling declaration
						parent.nodes.forEach(function (sibling) {
							// if the sibling is a matching declaration
							if (sibling.type === 'decl' && matchProp.test(sibling.prop)) {
								// update the corresponding attribute on the clone
								clone.attr[sibling.prop] = sibling.value;
							}
						});

						// update the url node
						url.value = node2uri(clone, document, isBase64);

						// add quote to base64 urls to improve compatibility
						if (!isBase64) {
							url.quote = '"';
							url.type = 'string';
						}
					}
				}).catch(function (error) {
					result.warn(error, node);
				}));
			});
		});

		// return chained css promises array
		return Promise.all(cssPromises).then(function () {
			modifiedDecls.forEach(function (decl) {
				// update the declaration value
				decl.value = decl.value.toString();
			});
		});
	};
});

function getElementById(node, id) {
	if (node.attr.id === id) {
		return node;
	} else {
		var index = -1;
		var child;

		while (child = node.children[++index]) {
			child = getElementById(child, id);

			if (child) {
				return child;
			}
		}

		return undefined;
	}
}

function node2uri(fragment, document, isBase64) {
	// rebuild fragment as <svg>
	fragment.name = 'svg';

	delete fragment.attr.id;

	fragment.attr.viewBox = fragment.attr.viewBox || document.attr.viewBox;

	fragment.attr.xmlns = 'http://www.w3.org/2000/svg';

	// build data URI
	var uri = 'data:image/svg+xml';

	uri += isBase64 ? ';base64,' : ',';

	uri += isBase64 ? encodeBase64(fragment) : encodeUTF8(fragment);

	// return data URI
	return uri;
}

function encodeBase64(stringable) {
	return new Buffer(String(stringable)).toString('base64');
}

function encodeUTF8(stringable) {
	return encodeURIComponent(
		String(stringable)
		// collapse whitespace
		.replace(/[\n\r\s\t]+/g, ' ')
		// remove comments
		.replace(/<\!\-\-([\W\w]*(?=\-\->))\-\->/g, '')
		// pre-encode ampersand
		.replace(/&/g, '%26')
	)
	// escape comma
	.replace(/'/g, '\\\'')
	// decode compatible characters
	.replace(/%20/g, ' ')
	.replace(/%22/g, '\'')
	.replace(/%2F/g, '/')
	.replace(/%3A/g, ':')
	.replace(/%3D/g, '=')
	// encode incompatible characters
	.replace(/\(/g, '%28')
	.replace(/\)/g, '%29');
}

function cloneNode(node) {
	var clone = {};

	for (var key in node) {
		if (node[key] instanceof Array) {
			clone[key] = node[key].map(cloneNode);
		} else if (typeof node[key] === 'object') {
			clone[key] = cloneNode(node[key]);
		} else {
			clone[key] = node[key];
		}
	}

	return clone;
}

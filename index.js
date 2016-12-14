// tooling
const fs      = require('fs');
const parser  = require('postcss-value-parser');
const path    = require('path');
const postcss = require('postcss');
const xmldoc  = require('xmldoc');

// url matcher
const urlMatch  = /(^|\s)url\(.+\.svg#.+\)(\s|$)/;

// property matcher
const propertyMatch = /^(color|fill|height|stroke|stroke-width|width)$/;

// plugin
module.exports = postcss.plugin('postcss-svg-fragments', ({
	utf8 = true
} = {}) => (css, result) => {
	// create a css promises array
	const cssPromises = [];

	// create an svg promises array
	const svgPromises = [];

	// create array with modified declarations
	const modifiedDecls = [];

	// walk each declaration
	css.walkDecls((decl) => {
		// if the declaration has a url
		if (urlMatch.test(decl.value)) {
			modifiedDecls.push(decl);

			// cache the declaration’s siblings
			const parent = decl.parent;

			// walk each node of the declaration
			decl.value = parser(decl.value).walk((node) => {
				// if the node is a url containing an svg fragment
				if (
					node.type === 'function' &&
					node.value === 'url' &&
					node.nodes.length !== 0 &&
					node.nodes[0].value.indexOf('.svg#') !== -1
				) {
					// current file path of the node
					const cwf = decl.source.input.file;

					// current file or current working directory
					const dir  = cwf ? path.dirname(cwf) : process.cwd();

					// parse the svg url
					const url   = node.nodes[0];
					const parts = url.value.split('#');
					const file  = path.join(dir, parts.shift());
					const id    = parts.join('#');

					// get cached svg promise
					const svgPromise = svgPromises[file] = svgPromises[file] || readFile(file, {
						encoding: 'utf8'
					}).then((content) => {
						// return an xml tree of the svg
						const document = new xmldoc.XmlDocument(content);

						document.ids = {};

						return document;
					});

					// push a modified svg promise to the declaration promises array
					cssPromises.push(svgPromise.then((document) => {
						if (id) {
							// cache fragment by id
							document.ids[id] = document.ids[id] || getElementById(document, id);

							// if the fragment id exists
							if (document.ids[id]) {
								// get cloned fragment
								const clonedFragment = cloneNode(document.ids[id]);

								// walk each sibling declaration
								parent.nodes.forEach((sibling) => {
									// if the sibling is a matching declaration
									if (sibling.type === 'decl' && propertyMatch.test(sibling.prop)) {
										// update the corresponding attribute on the clone
										clonedFragment.attr[sibling.prop] = sibling.value;
									}
								});

								// update the url node
								url.value = node2uri(clonedFragment, document, utf8);

								// add quote to base64 urls to improve compatibility
								if (utf8) {
									url.quote = '"';
									url.type = 'string';
								}
							}
						} else {
							// get cloned fragment
							const clonedDocument = cloneNode(document);

							// walk each sibling declaration
							parent.nodes.forEach((sibling) => {
								// if the sibling is a matching declaration
								if (sibling.type === 'decl' && propertyMatch.test(sibling.prop)) {
									// update the corresponding attribute on the clone
									clonedDocument.attr[sibling.prop] = sibling.value;
								}
							});

							// update the url node
							url.value = node2uri(clonedDocument, document, utf8);

							// add quote to base64 urls to improve compatibility
							if (utf8) {
								url.quote = '"';
								url.type = 'string';
							}
						}
					}).catch((error) => {
						result.warn(error, node);
					}));
				}
			});
		}
	});

	// return chained css promises array
	return Promise.all(cssPromises).then(() => {
		modifiedDecls.forEach((decl) => {
			// update the declaration value
			decl.value = decl.value.toString();
		});
	});
});

// override plugin#process
module.exports.process = function (cssString, pluginOptions, processOptions) {
	return postcss([
		0 in arguments ? module.exports(pluginOptions) : module.exports()
	]).process(cssString, processOptions);
};

const getElementById = (node, id) => {
	if (node.attr.id === id) {
		return node;
	} else {
		let index = -1;
		let child;

		while (child = node.children[++index]) {
			child = getElementById(child, id);

			if (child) {
				return child;
			}
		}

		return undefined;
	}
};

const node2uri = (fragment, document, utf8) => {
	// rebuild fragment as <svg>
	fragment.name = 'svg';

	delete fragment.attr.id;

	fragment.attr.viewBox = fragment.attr.viewBox || document.attr.viewBox;

	fragment.attr.xmlns = 'http://www.w3.org/2000/svg';

	const xml = String(fragment);

	// return data URI
	return `data:image/svg+xml;${ utf8 ? `charset=utf-8,${ encodeUTF8(xml) }` : `base64,${ new Buffer(xml).toString('base64') }` }`;
};

// encode the string as utf-8
const encodeUTF8 = (string) => encodeURIComponent(
	string.replace(
		// collapse whitespace
		/[\n\r\s\t]+/g, ' '
	).replace(
		// remove comments
		/<\!--([\W\w]*(?=-->))-->/g, ''
	).replace(
		// pre-encode ampersands
		/&/g, '%26'
	)
).replace(
	// escape commas
	/'/g, '\\\''
).replace(
	// un-encode compatible characters
	/%20/g, ' '
).replace(
	/%22/g, '\''
).replace(
	/%2F/g, '/'
).replace(
	/%3A/g, ':'
).replace(
	/%3D/g, '='
).replace(
	// encode additional incompatible characters
	/\(/g, '%28'
).replace(
	/\)/g, '%29'
);

const readFile = (file) => new Promise(
	(resolve, reject) => fs.readFile(
		file,
		'utf8',
		(error, data) => error ? reject(error) : resolve(data)
	)
);

const cloneNode = (node) => {
	const clone = {};

	for (let key in node) {
		if (node[key] instanceof Array) {
			clone[key] = node[key].map(cloneNode);
		} else if (typeof node[key] === 'object') {
			clone[key] = cloneNode(node[key]);
		} else {
			clone[key] = node[key];
		}
	}

	return clone;
};

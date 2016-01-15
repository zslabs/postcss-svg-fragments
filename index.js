var fs      = require('fs');
var parser  = require('postcss-value-parser');
var path    = require('path');
var postcss = require('postcss');
var xmldoc  = require('xmldoc');

var matchProp = /^(color|fill|height|stroke|stroke-width|width)$/;
var matchURL  = /(^|\s)url\(.+\.svg#.+\)(\s|$)/;

module.exports = postcss.plugin('postcss-svg-fragments', function (opts) {
	var isBase64 = opts && opts.encoding === 'base64';

	return function (css, result) {
		var cwf = result.root.source.input.file;
		var dir  = cwf ? path.dirname(cwf) : process.cwd();

		css.walkDecls(function (decl) {
			if (!matchURL.test(decl.value)) return;

			var value = parser(decl.value).walk(function (node) {
				if (node.type !== 'function' || node.value !== 'url' || !matchURL.test(parser.stringify(node))) return;

				var url   = node.nodes[0];
				var parts = url.value.split('#');
				var file  = path.join(dir, parts.shift());
				var id    = parts.join('#');

				var content = '';

				try {
					content = fs.readFileSync(file, 'utf8');
				} catch (error) {
					result.warn(error);
				}

				if (!content) return;

				var document = new xmldoc.XmlDocument(content);

				var fragment = getElementById(document, id);

				if (!fragment) return;

				decl.parent.nodes.forEach(function (sibling) {
					if (sibling.type !== 'decl' || !matchProp.test(sibling.prop)) return;

					fragment.attr[sibling.prop] = sibling.value;
				});

				url.value = node2uri(fragment, document, isBase64);
			}).toString();

			if (value !== decl.value) decl.value = value;
		});
	};
});

function getElementById(node, id) {
	if (node.attr.id === id) return node;
	else {
		var index = -1;
		var child;

		while (child = node.children[++index]) {
			child = getElementById(child, id);

			if (child) return child;
		}
	}
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
	.replace(/%2F/g, '/')
	.replace(/%3A/g, ':')
	.replace(/%3D/g, '=')
	// encode incompatible characters
	.replace(/\(/g, '%28')
	.replace(/\)/g, '%29');
}

function node2uri(node, root, isBase64) {
	// rebuild node as <svg>
	node.name = 'svg';

	delete node.attr.id;

	node.attr.viewBox = node.attr.viewBox || root.attr.viewBox;

	node.attr.xmlns = 'http://www.w3.org/2000/svg';

	// build data URI
	var uri = 'data:image/svg+xml;';

	uri += isBase64 ? 'base64,' : 'charset=utf-8,';

	uri += isBase64 ? encodeBase64(node) : encodeUTF8(node);

	// return data URI
	return uri;
}

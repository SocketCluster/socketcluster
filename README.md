# Asyngular

Toolset and boilerplate for quickly creating systems using Asyngular.
See the client and server repos for documentation:

- https://github.com/SocketCluster/asyngular-client
- https://github.com/SocketCluster/asyngular-server

Documentation for AGC (horizontally scalable cluster) is available at https://github.com/SocketCluster/asyngular/blob/master/agc-guide.md

## Installation

Setup the `asyngular` command:

```bash
npm install -g asyngular
```

or:

```bash
sudo npm install -g asyngular
```

then:

```bash
asyngular create myapp
```

Once it's installed, go to your new myapp/ directory and launch with:

```bash
node server
```

Access at URL http://localhost:8000/

Node.js `v10.0.0` or above is recommended but you can also use Asyngular with older Node.js versions if you use `while` loops instead of `for-await-of` loops.

## Change log

See the 'releases' section for changes: https://github.com/SocketCluster/asyngular/releases

## License

(The MIT License)

Copyright (c) 2013-2019 SocketCluster.io

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

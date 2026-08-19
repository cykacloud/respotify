# third-party notices

## shannon stream cipher

`src/utils/shannon.ts` is a typescript port of
[twonky4/shannon](https://github.com/twonky4/shannon), which is itself a port of
felix bruns' javascript implementation of the original c reference.

vendored rather than depended on: it is a single 0.0.1 release from 2019 with one
maintainer, and a cipher in the authentication path is not somewhere to inherit a
dependency that will never be patched. the upstream test vectors ship with it, in
`tests/shannon.test.ts`.

```
The MIT License (MIT)

Copyright (c) 2018 Alexander Kose <twonky4@gmx.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

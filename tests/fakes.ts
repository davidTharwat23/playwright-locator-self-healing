/**
 * Minimal fake Playwright Locator/Page for unit-testing the proxies without a
 * real browser. Only the surface the proxies touch is implemented.
 */

import type { Locator, Page } from '@playwright/test';

export interface FakeLocatorOptions {
    /** Actions that should throw when called, keyed by action name. */
    failing?: Record<string, Error>;
    /** A label to identify this fake in assertions. */
    label?: string;
}

export interface FakeLocator {
    label: string;
    calls: Array<{ method: string; args: unknown[] }>;
    click: (...args: unknown[]) => Promise<string>;
    fill: (...args: unknown[]) => Promise<string>;
    waitFor: (...args: unknown[]) => Promise<string>;
    // chaining
    filter: (...args: unknown[]) => FakeLocator;
    nth: (...args: unknown[]) => FakeLocator;
    first: (...args: unknown[]) => FakeLocator;
    getByRole: (...args: unknown[]) => FakeLocator;
    // non-action passthrough
    count: (...args: unknown[]) => Promise<number>;
}

export function makeFakeLocator(options: FakeLocatorOptions = {}): FakeLocator {
    const failing = options.failing ?? {};
    const calls: FakeLocator['calls'] = [];

    const action = (name: string) => (...args: unknown[]): Promise<string> => {
        calls.push({ method: name, args });
        if (failing[name]) return Promise.reject(failing[name]);
        return Promise.resolve(`${name}:ok`);
    };

    const chain = (name: string) => (...args: unknown[]): FakeLocator => {
        calls.push({ method: name, args });
        return makeFakeLocator({ label: `${options.label ?? 'loc'}>${name}` });
    };

    const self: FakeLocator = {
        label: options.label ?? 'loc',
        calls,
        click: action('click'),
        fill: action('fill'),
        waitFor: action('waitFor'),
        filter: chain('filter'),
        nth: chain('nth'),
        first: chain('first'),
        getByRole: chain('getByRole'),
        count: (...args: unknown[]) => {
            calls.push({ method: 'count', args });
            return Promise.resolve(1);
        },
    };
    return self;
}

export interface FakePageOptions {
    /** The locator returned by every factory call. */
    locator?: FakeLocator;
    factoryCalls?: Array<{ method: string; args: unknown[] }>;
}

export interface FakePage {
    factoryCalls: Array<{ method: string; args: unknown[] }>;
    lastReturned?: FakeLocator;
    locator: (...args: unknown[]) => FakeLocator;
    getByTestId: (...args: unknown[]) => FakeLocator;
    getByRole: (...args: unknown[]) => FakeLocator;
    title: () => Promise<string>;
    url: () => string;
}

export function makeFakePage(): FakePage {
    const factoryCalls: FakePage['factoryCalls'] = [];
    const page: FakePage = {
        factoryCalls,
        locator: (...args: unknown[]) => factory('locator', args),
        getByTestId: (...args: unknown[]) => factory('getByTestId', args),
        getByRole: (...args: unknown[]) => factory('getByRole', args),
        title: () => Promise.resolve('fake-title'),
        url: () => 'https://fake.test/',
    };

    function factory(method: string, args: unknown[]): FakeLocator {
        factoryCalls.push({ method, args });
        const loc = makeFakeLocator({ label: `${method}(${String(args[0])})` });
        page.lastReturned = loc;
        return loc;
    }

    return page;
}

/** Cast helpers so the proxies accept the fakes as Playwright types in tests. */
export const asLocator = (l: FakeLocator): Locator => l as unknown as Locator;
export const asPage = (p: FakePage): Page => p as unknown as Page;

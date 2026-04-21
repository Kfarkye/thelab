import { describe, it, expect } from 'vitest';
import { render, buildPage } from './portal-template';

describe('portal-template', () => {
  describe('simple interpolation', () => {
    it('replaces {{path}} with value', () => {
      expect(render('Hi {{name}}', { name: 'Anna' })).toBe('Hi Anna');
    });

    it('handles nested paths', () => {
      expect(render('{{user.name}}', { user: { name: 'Gary' } })).toBe('Gary');
    });

    it('returns empty string for missing paths', () => {
      expect(render('{{missing}}', {})).toBe('');
      expect(render('{{a.b.c}}', { a: { b: null } })).toBe('');
    });

    it('escapes HTML by default', () => {
      expect(render('{{x}}', { x: '<script>alert(1)</script>' })).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });

    it('passes raw through {{{path}}}', () => {
      expect(render('{{{x}}}', { x: '<b>bold</b>' })).toBe('<b>bold</b>');
    });
  });

  describe('#each', () => {
    it('iterates arrays', () => {
      const out = render(
        '{{#each items}}<li>{{name}}</li>{{/each}}',
        { items: [{ name: 'A' }, { name: 'B' }] }
      );
      expect(out).toBe('<li>A</li><li>B</li>');
    });

    it('renders nothing for missing array', () => {
      expect(render('{{#each nope}}X{{/each}}', {})).toBe('');
    });

    it('renders nothing for empty array', () => {
      expect(render('{{#each empty}}X{{/each}}', { empty: [] })).toBe('');
    });

    it('exposes parent via _parent', () => {
      const out = render(
        '{{#each items}}{{name}}@{{_parent.brand}}{{/each}}',
        { brand: 'Co', items: [{ name: 'a' }] }
      );
      expect(out).toBe('a@Co');
    });
  });

  describe('#if', () => {
    it('renders when truthy', () => {
      expect(render('{{#if x}}Y{{/if}}', { x: 'hi' })).toBe('Y');
      expect(render('{{#if x}}Y{{/if}}', { x: 5 })).toBe('Y');
      expect(render('{{#if x}}Y{{/if}}', { x: [1] })).toBe('Y');
    });

    it('renders empty when falsy', () => {
      expect(render('{{#if x}}Y{{/if}}', { x: 0 })).toBe('');
      expect(render('{{#if x}}Y{{/if}}', { x: '' })).toBe('');
      expect(render('{{#if x}}Y{{/if}}', { x: null })).toBe('');
      expect(render('{{#if x}}Y{{/if}}', { x: [] })).toBe('');
      expect(render('{{#if x}}Y{{/if}}', {})).toBe('');
    });
  });

  describe('nested blocks', () => {
    it('handles if inside each', () => {
      const out = render(
        '{{#each xs}}{{#if active}}{{name}}{{/if}}{{/each}}',
        { xs: [{ name: 'a', active: true }, { name: 'b', active: false }, { name: 'c', active: true }] }
      );
      expect(out).toBe('ac');
    });
  });

  describe('buildPage', () => {
    it('wraps rendered body with styled html doc', () => {
      const out = buildPage({
        title: 'Test',
        html: '<h1>{{name}}</h1>',
        css: 'h1 { color: red; }',
        data: { name: 'X' },
      });
      expect(out).toContain('<title>Test</title>');
      expect(out).toContain('h1 { color: red; }');
      expect(out).toContain('<h1>X</h1>');
    });

    it('escapes title', () => {
      const out = buildPage({
        title: '<script>',
        html: '',
        css: '',
        data: {},
      });
      expect(out).toContain('&lt;script&gt;');
    });

    it('adds noindex when requested', () => {
      const out = buildPage({ html: '', css: '', data: {}, noindex: true });
      expect(out).toContain('noindex, nofollow');
    });
  });
});

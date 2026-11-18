# Shared dashboard design system (shared/ui-web): the files Chronicle, Haystack and Manure ship under /ui/.
{ lib }:
lib.fileset.toSource {
  root = ../../shared/ui-web;
  fileset = lib.fileset.unions [
    ../../shared/ui-web/tokens.css
    ../../shared/ui-web/components.css
    ../../shared/ui-web/theme-init.js
    ../../shared/ui-web/icons.js
    ../../shared/ui-web/fonts
  ];
}

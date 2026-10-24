// Allow TypeScript to handle CSS module imports
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

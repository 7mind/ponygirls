export async function openTableOptions(page, name) {
  const controls = page.getByRole('region', { name: `${name} table controls`, exact: true });
  await controls.getByRole('button', { name: `${name} table options`, exact: true }).click();
  await controls.getByRole('button', { name: 'Fit to width', exact: true }).waitFor();
  return controls;
}
export async function showAllTableColumns(page, name) {
  const controls = await openTableOptions(page, name), columns = controls.locator('details');
  if (!await columns.evaluate(element => element.open)) await columns.locator('summary').click();
  await controls.getByRole('button', { name: 'Show all columns', exact: true }).click();
  await controls.getByRole('button', { name: `${name} table options`, exact: true }).click();
}

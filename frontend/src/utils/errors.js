export function extractErrorMessage(err, fallback = '请求失败，请稍后再试') {
  return err?.response?.data?.message || fallback;
}

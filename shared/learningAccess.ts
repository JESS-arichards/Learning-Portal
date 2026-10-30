export function canUseLearning(user: { roles: readonly string[]; department?: string | null }): boolean {
  return user.roles.includes('Full Admin') || user.roles.includes('Staff')
    || (user.roles.includes('Student')
      && ['jumeirah student', 'primary student'].includes(user.department?.trim().toLowerCase() ?? ''));
}

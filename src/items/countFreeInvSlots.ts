import UserProfile from '../interfaces/UserProfile';
import countItems from './countItems';

// saskaita cik brīvas vietas lietotāja inventārā
export default function(user: UserProfile): number {
  const freeSlots = user.itemCap - countItems(user.items)

  return freeSlots > 0
    ? freeSlots
    : 0
}
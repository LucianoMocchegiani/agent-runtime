import ChatStyles from './ActivityDots.module.css';
export default function ActivityDots() {
  return (
    <span className={ChatStyles.activityDots} aria-hidden="true">
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

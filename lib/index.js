// Entry point for your plugin
// This should expose your plugin's modules
/* START IMPORTS */
import Immutable from 'seamless-immutable';

import modules from './plugins';
import RecentBlocks from './components/RecentBlocks';
import { addRecentBlock, getRecentBlocks } from './actions';
import {
  ADD_NEW_BLOCK,
  ADD_RECENT_BLOCK,
  SET_RECENT_BLOCKS
} from './constants';
import { recentBlocks } from './selectors';
const { getBlocksWithTxCount } = recentBlocks;
/* END IMPORTS */

const plugins = Object.keys(modules).map(name => modules[name]);

/* START EXPORTS */

export const metadata = {
  name: '@bpanel/recent-blocks',
  pathName: '',
  displayName: 'Recent Blocks',
  author: 'bcoin-org',
  description:
    'A widget that shows the recent block information with expandable rows, optimized for bpanel dashboard',
  version: require('../package.json').version
};

export const pluginConfig = { plugins };

export const getRouteProps = {
  '@bpanel/dashboard': (parentProps, props) =>
    Object.assign(props, {
      chainHeight: parentProps.chainHeight,
      recentBlocks: parentProps.recentBlocks,
      getRecentBlocks: parentProps.getRecentBlocks,
      progress: parentProps.progress
    })
};

// This connects your plugin's component to the state's dispatcher
// Make sure to pass in an actual action to the dispatcher
export const mapComponentDispatch = {
  Panel: (dispatch, map) =>
    Object.assign(map, {
      getRecentBlocks: (n = 10) => dispatch(getRecentBlocks(n))
    })
};

// Tells the decorator what our plugin needs from the state
// This is available for container components that use an
// extended version of react-redux's connect to connect
// a container to the state and retrieve props
// make sure to replace the corresponding state mapping
// (e.g. `state.chain.height`) and prop names
export const mapComponentState = {
  Panel: (state, map) =>
    Object.assign(map, {
      chainHeight: state.chain.height,
      recentBlocks: state.chain.recentBlocks ? getBlocksWithTxCount(state) : [],
      progress: state.chain.progress
    })
};

// custom middleware for our plugin. This gets
// added to the list of middlewares in the app's store creator
// Use this to intercept and act on dispatched actions
// e.g. for responding to socket events
export const middleware = ({ dispatch, getState }) => next => action => {
  const { type, payload } = action;
  const { recentBlocks, progress } = getState().chain;
  if (
    type === ADD_NEW_BLOCK &&
    recentBlocks &&
    recentBlocks.length &&
    progress > 0.9
  ) {
    // if dispatched action is ADD_NEW_BLOCK,
    // and recent blocks are already loaded
    // this middleware will intercept and dispatch addRecentBlock
    dispatch(addRecentBlock(...payload));
  }
  return next(action);
};

// decorator for the chain reducer
// this will extend the current chain reducer
// make sure to replace the constants
// and prop names with your actual targets
// NOTE: state uses `seamless-immutable` to ensure immutability
// See their API Docs for more details (e.g. `set`)
// https://www.npmjs.com/package/seamless-immutable
export const reduceChain = (state, action) => {
  const { type, payload } = action;

  switch (type) {
    case SET_RECENT_BLOCKS: {
      if (payload.length)
        return state.set('recentBlocks', Immutable(payload), { deep: true });
      return state;
    }

    case ADD_RECENT_BLOCK: {
      const block = Immutable(payload);
      const numBlocks = 10;
      const blocks = state.getIn(['recentBlocks']);
      let newBlocks = [...blocks]; // get mutable version of blocks

      // skip if the height of new block is same as top block
      // or recentBlocks haven't been hydrated yet
      // reason is new block can be received multiple times
      if (blocks && blocks.length && block.height !== blocks[0].height) {
        newBlocks.unshift(block);
        // check if action includes a length to limit recent blocks list to
        if (numBlocks && state.recentBlocks.length >= numBlocks) {
          newBlocks.pop();
        }
        newBlocks = newBlocks.map(block =>
          block.set('depth', block.depth ? block.depth + 1 : 1)
        );
      }

      return state.merge({
        recentBlocks: Immutable(newBlocks)
      });
    }

    default:
      return state;
  }
};

// very/exactly similar to normal decorators
// name can be anything, but must match it to target
// plugin name via decoratePlugin export below
const decorateDashboard = (Dashboard, { React, PropTypes }) => {
  return class extends React.PureComponent {
    constructor(props) {
      super(props);
      this.requestedBlocks = false;
      this.blockCount = 10;
    }

    static get displayName() {
      return metadata.displayName;
    }

    static get propTypes() {
      return {
        primaryWidget: PropTypes.oneOf([PropTypes.array, PropTypes.node]),
        chainHeight: PropTypes.number,
        recentBlocks: PropTypes.array,
        getRecentBlocks: PropTypes.func,
        progress: PropTypes.number
      };
    }

    componentWillMount() {
      const { recentBlocks, getRecentBlocks, chainHeight, progress } = this.props;
      this.recentBlocks = RecentBlocks({
        recentBlocks,
        getRecentBlocks,
        chainHeight,
        progress
      });
      getRecentBlocks(this.blockCount);
    }

    componentWillUnmount() {
      this.requestedBlocks = false;
    }

    componentDidUpdate({ chainHeight: prevHeight }) {
      const { chainHeight, recentBlocks = [], getRecentBlocks } = this.props;

      if (
        chainHeight > prevHeight &&
        (!recentBlocks.length && !this.requestedBlocks)
      ) {
        // if chainHeight has increased and recentBlocks is not set,
        // get the most recent blocks
        // `getRecentBlocks` is attached to the store
        // and will dispatch action creators to udpate the state
        getRecentBlocks(this.blockCount);
        this.requestedBlocks = true;
      }
    }

    componentWillUpdate({
      chainHeight: nextHeight,
      recentBlocks: nextBlocks,
      progress
    }) {
      const { chainHeight, recentBlocks = [], getRecentBlocks } = this.props;
      if (recentBlocks.length && this.requestedBlocks)
        this.requestedBlocks = false;

      if (
        (progress > 0.9 && (nextHeight && nextHeight > chainHeight)) ||
        (recentBlocks[0] && recentBlocks[0].hash !== nextBlocks[0].hash) ||
        (!recentBlocks[0] && nextBlocks[0])
      ) {
        // otherwise if we just have an update to the chainHeight
        // or recent blocks we should update the table
        this.recentBlocks = RecentBlocks({
          chainHeight: nextHeight,
          recentBlocks: nextBlocks,
          getRecentBlocks,
          progress
        });
      }
    }

    render() {
      const { primaryWidget = [] } = this.props;
      primaryWidget.push(this.recentBlocks);
      return <Dashboard {...this.props} primaryWidget={primaryWidget} />;
    }
  };
};

// `decoratePlugin` passes an object with properties to map to the
// plugins they will decorate. Must match target plugin name exactly
export const decoratePlugin = { '@bpanel/dashboard': decorateDashboard };

/* END EXPORTS */
